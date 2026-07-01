(function () {
  "use strict";

  var COLORS = [
    "#3979a8", "#d06f52", "#6b9b62", "#aa6ca8", "#cc9b36",
    "#4e9c9c", "#a45d69", "#7f74b5", "#788a45", "#b56f9d"
  ];

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderMap(container, data, modelName, classIndex) {
    var canvas = element("canvas");
    var tooltip = element("div", "embedding-map-tooltip");
    var tooltipImage = element("img");
    var tooltipLabel = element("span");
    var hoveredIndex = -1;
    var width = 0;
    var height = 0;
    var pixelRatio = 1;

    tooltip.hidden = true;
    tooltipImage.alt = "";
    tooltip.appendChild(tooltipImage);
    tooltip.appendChild(tooltipLabel);
    container.appendChild(canvas);
    container.appendChild(tooltip);

    function draw() {
      var context = canvas.getContext("2d");
      if (!context || !width || !height) return;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      data.images.forEach(function (item, index) {
        var coordinates = item.tsne[modelName];
        var x = coordinates[0] * width;
        var y = coordinates[1] * height;
        context.beginPath();
        context.arc(x, y, index === hoveredIndex ? 5.5 : 3.2, 0, Math.PI * 2);
        context.fillStyle = COLORS[classIndex[item.classId]];
        context.globalAlpha = index === hoveredIndex ? 1 : 0.82;
        context.fill();
        context.globalAlpha = 1;
        context.lineWidth = index === hoveredIndex ? 2.5 : 1.1;
        context.strokeStyle = index === hoveredIndex ? "#20333f" : "rgba(255,255,255,.9)";
        context.stroke();
      });
    }

    function resize() {
      var bounds = container.getBoundingClientRect();
      width = Math.round(bounds.width);
      height = Math.round(bounds.height);
      if (!width || !height) return;
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      draw();
    }

    function nearestPoint(event) {
      var bounds = canvas.getBoundingClientRect();
      var pointerX = event.clientX - bounds.left;
      var pointerY = event.clientY - bounds.top;
      var nearest = -1;
      var nearestDistance = 100;
      data.images.forEach(function (item, index) {
        var coordinates = item.tsne[modelName];
        var dx = coordinates[0] * width - pointerX;
        var dy = coordinates[1] * height - pointerY;
        var distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      });
      return nearest;
    }

    function updateTooltip(index) {
      if (index === hoveredIndex) return;
      hoveredIndex = index;
      if (index < 0) {
        tooltip.hidden = true;
        draw();
        return;
      }

      var item = data.images[index];
      var coordinates = item.tsne[modelName];
      var x = coordinates[0] * width;
      var y = coordinates[1] * height;
      tooltipImage.src = item.src;
      tooltipLabel.textContent = item.label;
      tooltip.style.left = Math.max(6, Math.min(width - 100, x + 10)) + "px";
      tooltip.style.top = (y > 125 ? y - 118 : y + 10) + "px";
      tooltip.hidden = false;
      draw();
    }

    canvas.addEventListener("pointermove", function (event) {
      updateTooltip(nearestPoint(event));
    });
    canvas.addEventListener("pointerdown", function (event) {
      updateTooltip(nearestPoint(event));
    });
    canvas.addEventListener("pointerleave", function () { updateTooltip(-1); });

    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(container);
    } else {
      window.addEventListener("resize", resize);
    }
    resize();
  }

  function renderLegend(container, classes) {
    classes.forEach(function (item, index) {
      var legend = element("span", "embedding-legend-item");
      var dot = element("span", "embedding-legend-dot");
      dot.style.setProperty("--legend-color", COLORS[index]);
      legend.appendChild(dot);
      legend.appendChild(document.createTextNode(item.label));
      container.appendChild(legend);
    });
  }

  function renderResults(container, data, modelName, queryIndex) {
    var ranked = data.images.slice().sort(function (a, b) {
      return b.scores[modelName][queryIndex] - a.scores[modelName][queryIndex];
    }).slice(0, 5);

    var fragment = document.createDocumentFragment();
    ranked.forEach(function (item, index) {
      var figure = element("figure", "retrieval-item");
      var imageWrap = element("div", "retrieval-image-wrap");
      var image = element("img");
      image.src = item.src;
      image.alt = item.label;
      image.decoding = "async";
      imageWrap.appendChild(image);
      imageWrap.appendChild(element("span", "retrieval-rank", String(index + 1)));

      var caption = document.createElement("figcaption");
      caption.appendChild(element("span", "retrieval-label", item.label));
      caption.appendChild(
        element("span", "retrieval-score", "cos " + item.scores[modelName][queryIndex].toFixed(3))
      );
      figure.appendChild(imageWrap);
      figure.appendChild(caption);
      fragment.appendChild(figure);
    });
    container.replaceChildren(fragment);
  }

  function initialize(data) {
    var demo = document.getElementById("embeddingDemo");
    var status = document.getElementById("embeddingDemoStatus");
    var content = document.getElementById("embeddingDemoContent");
    var classIndex = {};
    data.classes.forEach(function (item, index) { classIndex[item.id] = index; });

    status.hidden = true;
    content.hidden = false;
    demo.setAttribute("aria-busy", "false");

    renderMap(document.getElementById("levlEmbeddingMap"), data, "levl", classIndex);
    renderMap(document.getElementById("clipEmbeddingMap"), data, "clip", classIndex);
    renderLegend(document.getElementById("embeddingLegend"), data.classes);

    var queryContainer = document.getElementById("embeddingQueries");
    var levlResults = document.getElementById("levlRetrieval");
    var clipResults = document.getElementById("clipRetrieval");
    var buttons = [];

    function selectQuery(index) {
      buttons.forEach(function (button, buttonIndex) {
        button.setAttribute("aria-pressed", buttonIndex === index ? "true" : "false");
      });
      renderResults(levlResults, data, "levl", index);
      renderResults(clipResults, data, "clip", index);
    }

    data.classes.forEach(function (item, index) {
      var button = element("button", "embedding-query", item.prompt);
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", function () { selectQuery(index); });
      buttons.push(button);
      queryContainer.appendChild(button);
    });

    selectQuery(4);
  }

  function showError(error) {
    var demo = document.getElementById("embeddingDemo");
    var status = document.getElementById("embeddingDemoStatus");
    if (!demo || !status) return;
    status.classList.add("is-error");
    status.textContent = "The precomputed demo could not be loaded.";
    demo.setAttribute("aria-busy", "false");
    if (window.console) console.error("Embedding demo:", error);
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.getElementById("embeddingDemo")) return;
    if (window.EMBEDDING_DEMO_DATA) {
      initialize(window.EMBEDDING_DEMO_DATA);
      return;
    }
    fetch("./static/embedding-demo/data.json")
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(initialize)
      .catch(showError);
  });
}());
