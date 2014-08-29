$("document").ready(function () {

  // Check for the various File API support.
  if (!window.File || !window.FileReader || !window.FileList || !window.Blob) {
    alert('The File APIs are not fully supported in this browser.');
  }

  var status   = $('#status');
  var progress = $('#progress');

  var distance = function(a, b) {
    return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2);
  }
  var tree = new kdTree(quadrillage, distance, ["x", "y"]);

  function readFile() {

    var file = $('#file').prop('files')[0];
    if (!file) { return; }

    var reader = new FileReader();
    status.text('Reading file');
    progress.width('0%');

    reader.onload = function (f) {
      var ext = file.name.substr(file.name.lastIndexOf('.') + 1);
      var delimiter = ';';
      if (ext == 'txt' || ext == 'tsv') { delimiter = '\t'; }

      var data = new CSV(f.target.result, { header: true, delimiter: delimiter }).parse();

      build(data);
    };

    reader.readAsText(file);
  }

  function build(data) {

    var ndx  = crossfilter(data);

    var parseDate     = d3.time.format('%Y-%m-%d').parse;
    var parseDatetime = d3.time.format.iso.parse;

    var granularity   = $('#granularity').val();
    var geoAvailable  = data[0].hasOwnProperty('geoip-latitude') && data[0].hasOwnProperty('geoip-longitude');

    if (geoAvailable) {
      $('#choropleth-chart').text('');
    } else {
      $('#choropleth-chart').text('Not available, add geoip-latitude and geoip-longitude to access this feature');
    }

    var rtypes = {};
    var mimes  = {};

    var i = 0;
    var l = data.length;

    status.text('Processing data');
    progress.text('0/' + l).width(0);

    (function processData(callback) {

      var m = i + 100;
      if (m > l) { m = l; }

      for (; i < m; i++) {
        var d = data[i];

        if (d.timestamp) {
          d.dd = new Date(d.timestamp * 1000);
        } else if (d.datetime) {
          d.dd = parseDatetime(d.datetime);
        } else if (d.date) {
          d.dd = parseDate(d.date);
        } else {
          continue;
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

        if (d.rtype && !rtypes[d.rtype]) { rtypes[d.rtype] = true; }
        if (d.mime && !mimes[d.mime])    { mimes[d.mime]   = true; }
        if (geoAvailable && d['geoip-latitude'] && d['geoip-longitude']) {

          var nearest = tree.nearest({
            x: d['geoip-longitude'],
            y: d['geoip-latitude']
          }, 1, 0.1);
          if (nearest.length > 0) {
            d.departmentName = nearest[0][0].name;
          } else {
            d.departmentName = '';
          }
        }
      }

      progress.text(m + '/' + l).width(m / l * 100 + '%');

      if (m == l) {
        status.text('Done');
        progress.width('100%');
        callback();
      } else {
        setTimeout(function () { processData(callback); });
      }
    })(function buildGraphs() {

      var dateDim      = ndx.dimension(function (d) { return d.dd; });
      var platformsDim = ndx.dimension(function (d) { return d.platform; });
      var mimeDim      = ndx.dimension(function (d) { return d.mime; });
      var rtypeDim     = ndx.dimension(function (d) { return d.rtype; });
      var departmentsDim;
      if (geoAvailable) {
        departmentsDim = ndx.dimension(function (d) { return d.departmentName; });
      }

      var minDate = new Date(dateDim.bottom(1)[0].dd);
      var maxDate = new Date(dateDim.top(1)[0].dd);

      var groupBy = function (field, value) {
        return dateDim.group().reduceSum(function (d) { return d[field] == value ? 1 : 0; });
      };

      // reset current charts
      dc.deregisterAllCharts();
      dc.renderlet(null);

      dc.dataCount("#data-count")
        .dimension(ndx)
        .group(ndx.groupAll());

      var lineChart   = dc.lineChart('#line-chart');
      var barChart    = dc.barChart('#bar-chart');
      var mimesChart  = dc.pieChart("#pie-chart-mimes");
      var rtypesChart = dc.pieChart("#pie-chart-rtypes");

      var firstGroup = true;
      lineChart
        .width(500).height(300)
        .margins({top: 30, right: 60, bottom: 25, left: 60})
        .dimension(dateDim);

      for (var mime in mimes) {
        if (firstGroup) {
          lineChart.group(groupBy('mime', mime), mime);
          firstGroup = false;
        } else {
          lineChart.stack(groupBy('mime', mime), mime);
        }
      }
      lineChart
        .x(d3.time.scale().domain([minDate, maxDate]))
        .renderArea(true)
        .mouseZoomable(false)
        .brushOn(true)
        .elasticY(true)
        .renderHorizontalGridLines(true)
        .legend(dc.legend().x(70).y(0).itemHeight(13).gap(5));

      var brush       = lineChart.brush();
      var extent      = brush.extent();
      var periodMin   = $('#p-min').text(minDate.toLocaleString());
      var periodMax   = $('#p-max').text(maxDate.toLocaleString());
      var eventsCount = $('#events-count').text(dateDim.top(Number.POSITIVE_INFINITY).length);
      // brush.on('brush', function () { console.log('move'); });
      // brush.on('brushstart', function () { console.log('start'); });
      brush.on('brushend', function () {
        extent = brush.extent();

        eventsCount.text(dateDim.top(Number.POSITIVE_INFINITY).length);
        if (extent[0].getTime() !== extent[1].getTime()) {
          periodMin.text(extent[0].toLocaleString());
          periodMax.text(extent[1].toLocaleString());
        } else {
          periodMin.text(minDate.toLocaleString());
          periodMax.text(maxDate.toLocaleString());
        }
      });

      barChart
        .width(500).height(300)
        .margins({top: 30, right: 60, bottom: 25, left: 60})
        .dimension(platformsDim)
        .group(platformsDim.group())
        .x(d3.scale.ordinal().domain(data.map(function(d) { return d.platform; })))
        .xUnits(dc.units.ordinal)
        .elasticY(true)
        .renderHorizontalGridLines(true);

      barChart.on("preRedraw", function (chart) {
          barChart.rescale();
      });
      barChart.on("preRender", function (chart) {
          barChart.rescale();
      });

      mimesChart
        .width(300).height(300)
        .dimension(mimeDim)
        .group(mimeDim.group())
        .innerRadius(30)
        .label(function (d) {
          return d.data.key + ' (' + d.data.value + ')';
        });

      rtypesChart
        .width(300).height(300)
        .dimension(rtypeDim)
        .group(rtypeDim.group())
        .innerRadius(30)
        .label(function (d) {
          return d.data.key + ' (' + d.data.value + ')';
        });

      if (geoAvailable) {
        var geoChart         = dc.geoChoroplethChart("#choropleth-chart");
        var departmentsGroup = departmentsDim.group();
        var colorRanges      = ["#E2F2FF", "#C4E4FF", "#9ED2FF", "#81C5FF", "#6BBAFF", "#51AEFF", "#36A2FF", "#1E96FF", "#0089FF", "#0061B5"];
        var dMax;
        var top = departmentsGroup.top(2);

        var zoom = function(target) {
          var zoom = d3.behavior.zoom()
              .scaleExtent([1, 15])
              .on("zoom", function move() {
                var t = d3.event.translate;
                var s = d3.event.scale;
                var h = mapHeight / 3;
                zoom.translate(t);
                g.style("stroke-width", 1 / s).attr("transform", "translate(" + t + "),scale(" + s + ")");
              });

          var mappa     = d3.select(target).call(zoom);
          var g         = mappa.select('g');
          var mapHeight = d3.select(target).attr('height')
        };

        geoChart
          .width(600).height(600)
          .dimension(departmentsDim)
          .group(departmentsGroup)
          .projection(d3.geo.mercator().center([8, 47]).scale(2000))
          .colorCalculator(function (d) {
            if (!d) { return '#ccc'; }

            var index = Math.floor(d / top[(top[0].name || !top[1]) ? 0 : 1].value * 10);
            if (index > 9) { index = 9; }
            return colorRanges[index];
          })
          .overlayGeoJson(geoJson.features, "department", function (d) {
            return d.properties.name;
          })
          .title(function (d) {
            return "Department: " + d.key + "\nConsultations: " + (d.value ? d.value : 0);
          });
      }

      dc.renderAll();
      if (geoAvailable) { zoom("#choropleth-chart"); }
    });
  }

  $('#launcher').click(readFile);
});