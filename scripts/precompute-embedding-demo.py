#!/usr/bin/env python3
"""Precompute the static data used by the embedding demo on the project page.

The browser receives only small WebP thumbnails, two-dimensional t-SNE
coordinates, and text-to-image cosine similarities. No model code or weights
are shipped with the site.
"""

from __future__ import annotations

import argparse
import gc
import json
import random
from pathlib import Path

import numpy as np
import timm
import torch
import torch.nn as nn
import torch.nn.functional as F
from huggingface_hub import hf_hub_download
from PIL import Image
from safetensors.torch import load_file
from sklearn.manifold import TSNE
from transformers import AutoTokenizer, GPT2Config, GPT2Model
from torchvision import transforms
from torchvision.transforms import InterpolationMode


MODELS = {
    "levl": {
        "repo": "lukaskuhndkfz/LeVLJEPA-ViT-B-DataComp-200k",
        "embed_dim": 256,
        "predictive": True,
    },
    "clip": {
        "repo": "lukaskuhndkfz/InfoNCE-ViT-B-DataComp-200k",
        "embed_dim": 512,
        "predictive": False,
    },
}

CLASSES = {
    "n01440764": ("tench", "a photo of a tench fish"),
    "n02102040": ("springer", "a photo of an English springer dog"),
    "n02979186": ("cassette player", "a photo of a cassette player"),
    "n03000684": ("chainsaw", "a photo of a chainsaw"),
    "n03028079": ("church", "a photo of a church"),
    "n03394916": ("French horn", "a photo of a French horn"),
    "n03417042": ("garbage truck", "a photo of a garbage truck"),
    "n03425413": ("gas pump", "a photo of a gas pump"),
    "n03445777": ("golf ball", "a photo of a golf ball"),
    "n03888257": ("parachute", "a photo of a parachute"),
}

HIDDEN = 768
WIDTH = 2048
DEPTH = 4


def subdict(weights: dict[str, torch.Tensor], prefix: str) -> dict[str, torch.Tensor]:
    return {key[len(prefix) :]: value for key, value in weights.items() if key.startswith(prefix)}


def build_pre_projection(embed_dim: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Linear(HIDDEN, WIDTH),
        nn.BatchNorm1d(WIDTH),
        nn.GELU(),
        nn.Linear(WIDTH, embed_dim),
    )


def build_predictor(embed_dim: int) -> nn.Sequential:
    layers: list[nn.Module] = []
    previous = embed_dim
    for _ in range(DEPTH):
        layers.extend(
            [
                nn.Linear(previous, WIDTH),
                nn.BatchNorm1d(WIDTH),
                nn.GELU(),
                nn.Dropout(0.0),
            ]
        )
        previous = WIDTH
    layers.append(nn.Linear(previous, embed_dim))
    return nn.Sequential(*layers)


def build_model(name: str) -> dict[str, object]:
    spec = MODELS[name]
    repo = str(spec["repo"])
    embed_dim = int(spec["embed_dim"])
    vision_weights = load_file(hf_hub_download(repo, "vision_encoder.safetensors"))
    text_weights = load_file(hf_hub_download(repo, "text_encoder.safetensors"))

    vision_encoder = timm.create_model(
        "vit_base_patch16_224", pretrained=False, num_classes=0, dynamic_img_size=True
    )
    vision_encoder.load_state_dict(subdict(vision_weights, "encoder."))
    vision_pre_proj = build_pre_projection(embed_dim)
    vision_pre_proj.load_state_dict(subdict(vision_weights, "pre_proj."))

    tokenizer = AutoTokenizer.from_pretrained("gpt2")
    tokenizer.pad_token = tokenizer.eos_token
    text_encoder = GPT2Model(
        GPT2Config(
            n_embd=HIDDEN,
            n_layer=12,
            n_head=12,
            n_inner=HIDDEN * 4,
            vocab_size=tokenizer.vocab_size,
            attn_pdrop=0.0,
            resid_pdrop=0.0,
            embd_pdrop=0.0,
        )
    )
    text_encoder.load_state_dict(subdict(text_weights, "encoder."))
    text_pre_proj = build_pre_projection(embed_dim)
    text_pre_proj.load_state_dict(subdict(text_weights, "pre_proj."))

    modules: dict[str, object] = {
        "vision_encoder": vision_encoder,
        "vision_pre_proj": vision_pre_proj,
        "tokenizer": tokenizer,
        "text_encoder": text_encoder,
        "text_pre_proj": text_pre_proj,
    }
    if bool(spec["predictive"]):
        text_predictor = build_predictor(embed_dim)
        text_predictor.load_state_dict(subdict(text_weights, "projector."))
        modules["text_predictor"] = text_predictor

    for module in modules.values():
        if isinstance(module, nn.Module):
            module.eval()
    return modules


def tokenize(tokenizer: AutoTokenizer, prompts: list[str]) -> dict[str, torch.Tensor]:
    sequences: list[list[int]] = []
    for prompt in prompts:
        ids = tokenizer(
            prompt, add_special_tokens=False, truncation=True, max_length=76
        )["input_ids"]
        sequences.append(ids + [tokenizer.eos_token_id])
    length = max(map(len, sequences))
    input_ids, attention_masks = [], []
    for ids in sequences:
        padding = length - len(ids)
        input_ids.append(ids + [tokenizer.pad_token_id] * padding)
        attention_masks.append([1] * len(ids) + [0] * padding)
    return {
        "input_ids": torch.tensor(input_ids),
        "attention_mask": torch.tensor(attention_masks),
    }


@torch.inference_mode()
def encode_text(model: dict[str, object], prompts: list[str]) -> tuple[torch.Tensor, torch.Tensor]:
    tokenizer = model["tokenizer"]
    inputs = tokenize(tokenizer, prompts)
    hidden = model["text_encoder"](**inputs).last_hidden_state
    lengths = inputs["attention_mask"].sum(1).long() - 1
    indices = lengths.view(-1, 1, 1).expand(-1, 1, hidden.shape[-1])
    pooled = hidden.gather(1, indices).squeeze(1)
    linear = model["text_pre_proj"](pooled)
    retrieval = model.get("text_predictor", nn.Identity())(linear)
    return F.normalize(linear, dim=-1), F.normalize(retrieval, dim=-1)


@torch.inference_mode()
def encode_images(
    model: dict[str, object], images: list[Image.Image], batch_size: int = 10
) -> torch.Tensor:
    preprocess = transforms.Compose(
        [
            transforms.Resize(224, interpolation=InterpolationMode.BICUBIC),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    linear_batches = []
    for start in range(0, len(images), batch_size):
        pixels = torch.stack([preprocess(image) for image in images[start : start + batch_size]])
        pooled = model["vision_encoder"](pixels)
        linear = model["vision_pre_proj"](pooled)
        linear_batches.append(F.normalize(linear, dim=-1))
    return torch.cat(linear_batches)


def choose_images(dataset_root: Path, per_class: int) -> list[dict[str, object]]:
    rng = random.Random(20260701)
    selected: list[dict[str, object]] = []
    for class_index, (synset, (label, _)) in enumerate(CLASSES.items()):
        candidates = sorted((dataset_root / synset).glob("*.JPEG"))
        for sample_index, path in enumerate(rng.sample(candidates, per_class)):
            selected.append(
                {
                    "id": f"{class_index:02d}-{sample_index:02d}",
                    "class_id": synset,
                    "label": label,
                    "path": path,
                }
            )
    return selected


def normalized_tsne(features: np.ndarray) -> np.ndarray:
    points = TSNE(
        n_components=2,
        perplexity=30,
        init="pca",
        learning_rate="auto",
        max_iter=1500,
        random_state=42,
    ).fit_transform(features)
    low, high = points.min(0), points.max(0)
    return 0.06 + 0.88 * (points - low) / np.maximum(high - low, 1e-8)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, default=Path("static/embedding-demo"))
    parser.add_argument("--per-class", type=int, default=50)
    args = parser.parse_args()

    output_images = args.output_root / "images"
    output_images.mkdir(parents=True, exist_ok=True)
    samples = choose_images(args.dataset_root, args.per_class)
    images: list[Image.Image] = []
    for sample in samples:
        image = Image.open(sample["path"]).convert("RGB")
        images.append(image.copy())
        display = transforms.Compose(
            [
                transforms.Resize(112, interpolation=InterpolationMode.BICUBIC),
                transforms.CenterCrop(112),
            ]
        )(image)
        display.save(output_images / f"{sample['id']}.webp", "WEBP", quality=70, method=6)

    prompts = [prompt for _, prompt in CLASSES.values()]
    model_outputs: dict[str, dict[str, np.ndarray]] = {}
    for model_name in ("levl", "clip"):
        print(f"Encoding with {model_name}...", flush=True)
        model = build_model(model_name)
        image_linear = encode_images(model, images)
        _, text_retrieval = encode_text(model, prompts)
        # Text-to-image retrieval follows the trained direction. LeVLJEPA maps
        # the text query into image space; InfoNCE already shares one space.
        similarities = image_linear @ text_retrieval.T
        model_outputs[model_name] = {
            "tsne": normalized_tsne(image_linear.numpy()),
            "similarities": similarities.numpy(),
        }
        del model, image_linear, text_retrieval, similarities
        gc.collect()

    payload = {
        "meta": {
            "dataset": "Imagenette validation split",
            "imageCount": len(samples),
            "seed": 20260701,
            "tsnePerplexity": 30,
        },
        "classes": [
            {"id": synset, "label": label, "prompt": prompt}
            for synset, (label, prompt) in CLASSES.items()
        ],
        "images": [],
    }
    for index, sample in enumerate(samples):
        payload["images"].append(
            {
                "id": sample["id"],
                "src": f"./static/embedding-demo/images/{sample['id']}.webp",
                "label": sample["label"],
                "classId": sample["class_id"],
                "tsne": {
                    model_name: [round(float(value), 5) for value in model_outputs[model_name]["tsne"][index]]
                    for model_name in MODELS
                },
                "scores": {
                    model_name: [
                        round(float(value), 6)
                        for value in model_outputs[model_name]["similarities"][index]
                    ]
                    for model_name in MODELS
                },
            }
        )

    serialized = json.dumps(payload, separators=(",", ":"))
    (args.output_root / "data.json").write_text(serialized, encoding="utf-8")
    (args.output_root / "data.js").write_text(
        "window.EMBEDDING_DEMO_DATA=" + serialized + ";\n", encoding="utf-8"
    )
    print(
        f"Wrote {args.output_root / 'data.json'}, {args.output_root / 'data.js'}, "
        f"and {len(samples)} thumbnails"
    )


if __name__ == "__main__":
    main()
