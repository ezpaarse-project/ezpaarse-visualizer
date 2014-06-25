$("document").ready(function () {

  // Check for the various File API support.
  if (!window.File || !window.FileReader || !window.FileList || !window.Blob) {
    alert('The File APIs are not fully supported in this browser.');
  }

  function handleFileSelect(evt) {

    var file = evt.target.files[0];
    if (!file) { return; }

    var reader   = new FileReader();
    var progress = $('#load-progress').text('0%');

    reader.onprogress = function (evt) {
      if (evt.lengthComputable) {
        var percentLoaded = Math.round((evt.loaded / evt.total) * 100);
        progress.text(percentLoaded + '%');
      }
    };

    reader.onload = function (f) {
      progress.text('100%');
      var data = new CSV(f.target.result, { header: true, delimiter: ';' }).parse();

      $('#granularity').off('change').on('change', function () { build(data); });
      build(data);
    };

    reader.readAsText(file);
  }

  function build(data) {
    var ndx  = crossfilter(data);

    var parseDate     = d3.time.format('%Y-%m-%d').parse;
    var parseDatetime = d3.time.format.iso.parse;

    var halfWidth   = ($(document).width() / 2) - 50;
    var granularity = $('#granularity').val();

    data.forEach(function (d) {
      if (d.timestamp) {
        d.dd = new Date(d.timestamp * 1000);
      } else if (d.datetime) {
        d.dd = parseDatetime(d.datetime);
      } else {
        d.dd = parseDate(d.date);
      }

      switch (granularity) {
        case 'month':
          d.dd = d3.time.month(d.dd);
        case 'week':
          d.dd = d3.time.week(d.dd);
        case 'day':
          d.dd = d3.time.day(d.dd);
        case 'hour':
          d.dd = d3.time.hour(d.dd);
        case 'minute':
          d.dd = d3.time.minute(d.dd);
      }
    });

    var dateDim      = ndx.dimension(function (d) { return d.dd; });
    var platformsDim = ndx.dimension(function (d) { return d.platform; });
    var mimeDim      = ndx.dimension(function (d) { return d.mime; });

    var minDate = new Date(dateDim.bottom(1)[0].dd);
    var maxDate = new Date(dateDim.top(1)[0].dd);

    var mimeHTML = dateDim.group().reduceSum(function (d) { return d.mime == "HTML" ? 1 : 0; });
    var mimePDF  = dateDim.group().reduceSum(function (d) { return d.mime == "PDF" ? 1 : 0; });
    var mimeMISC = dateDim.group().reduceSum(function (d) { return d.mime == "MISC" ? 1 : 0; });

    var lineChart = dc.lineChart('#line-chart');
    var barChart  = dc.barChart('#bar-chart');
    var pieChart  = dc.pieChart("#pie-chart");

    lineChart
      .width(halfWidth).height(300)
      .dimension(dateDim)
      .group(mimeHTML, "HTML")
      .stack(mimePDF, "PDF")
      .stack(mimeMISC, "MISC")
      .x(d3.time.scale().domain([minDate, maxDate]))
      .renderArea(true)
      .mouseZoomable(false)
      .brushOn(true)
      .elasticY(true)
      .renderHorizontalGridLines(true)
      .legend(dc.legend().x(50).y(0).itemHeight(13).gap(5))
      .yAxisLabel("Consultations");

    var brush     = lineChart.brush();
    var extent    = brush.extent();
    var periodMin = $('#p-min').text(minDate.toLocaleString());
    var periodMax = $('#p-max').text(maxDate.toLocaleString());
    // brush.on('brush', function () { console.log('move'); });
    // brush.on('brushstart', function () { console.log('start'); });
    brush.on('brushend', function () {
      extent = brush.extent();

      if (extent[0].getTime() !== extent[1].getTime()) {
        periodMin.text(extent[0].toLocaleString());
        periodMax.text(extent[1].toLocaleString());
      } else {
        periodMin.text(minDate.toLocaleString());
        periodMax.text(maxDate.toLocaleString());
      }
    });

    barChart
      .width(halfWidth).height(300)
      .dimension(platformsDim)
      .group(platformsDim.group())
      .x(d3.scale.ordinal().domain(data.map(function(d) { return d.platform; })))
      .xUnits(dc.units.ordinal)
      .elasticY(true)
      .renderHorizontalGridLines(true)
      .yAxisLabel("Consultations");

    barChart.on("preRedraw", function (chart) {
        barChart.rescale();
    });
    barChart.on("preRender", function (chart) {
        barChart.rescale();
    });

    pieChart
      .width(300).height(300)
      .dimension(mimeDim)
      .group(mimeDim.group())
      .innerRadius(30)
      .label(function (d) {
        return d.data.key + ' (' + d.data.value + ')';
      });

    dc.renderAll();
  }

  var fileInput = $('#file').change(handleFileSelect);
});