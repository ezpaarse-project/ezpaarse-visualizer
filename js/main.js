$("document").ready(function () {

  // Check for the various File API support.
  if (!window.File || !window.FileReader || !window.FileList || !window.Blob) {
    alert('The File APIs are not fully supported in this browser.');
  }

  var status    = $('#status');
  var progress  = $('#progress');
  var launcher  = $('#launcher');
  var restarter = $('#restarter');

  var distance = function(a, b) {
    return Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2);
  }
  var tree = new kdTree(quadrillage, distance, ["x", "y"]);

  function readFile() {

    var file = $('#file').prop('files')[0];
    if (!file) { return; }

    $('.step-1').show();
    launcher.prop('disabled', true);

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
    var geoAvailable  = data.length > 0 && data[0].hasOwnProperty('geoip-latitude') && data[0].hasOwnProperty('geoip-longitude');

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
      var platformsDim = ndx.dimension(function (d) { return d.platform_name || d.platform; });
      var titleDim     = ndx.dimension(function (d) { return d.publication_title; });
      var mimeDim      = ndx.dimension(function (d) { return d.mime; });
      var rtypeDim     = ndx.dimension(function (d) { return d.rtype; });
      var departmentsDim;
      if (geoAvailable) {
        departmentsDim = ndx.dimension(function (d) { return d.departmentName; });
      }

      var minDate;
      var maxDate;
      if (dateDim.bottom(1).length && dateDim.top(1).length) {
        minDate = new Date(dateDim.bottom(1)[0].dd);
        maxDate = new Date(dateDim.top(1)[0].dd);
      } else {
        minDate = new Date();
        maxDate = new Date(minDate.getTime() + 86400000);
      }

      var groupBy = function (field, value) {
        return dateDim.group().reduceSum(function (d) { return d[field] == value ? 1 : 0; });
      };

      // reset current charts
      dc.deregisterAllCharts();
      dc.renderlet(null);

      dc.dataCount("#data-count")
        .dimension(ndx)
        .group(ndx.groupAll());

      var rowChart    = dc.rowChart('#bar-chart');
      var mimesChart  = dc.pieChart("#pie-chart-mimes");
      var rtypesChart = dc.pieChart("#pie-chart-rtypes");
      var composite   = dc.compositeChart('#line-chart');

      composite.on("postRender", function rotateAxisLabels(c) {
        d3.selectAll('#line-chart .axis.x text')
          .style("text-anchor", "end" )
          .attr("transform", function(d) { return "rotate(-45, -4, 9) "; });
      });

      var composeCharts = [];
      var color = d3.scale.category20();

      for (var mime in mimes) {
        composeCharts.push(dc.lineChart(composite)
          .colors([color(mime)])
          .group(groupBy('mime', mime), mime));
      }

      composite
        .width(500).height(300)
        .dimension(dateDim)
        .margins({top: 30, right: 70, bottom: 50, left: 60})
        .x(d3.time.scale().domain([minDate, maxDate]))
        .compose(composeCharts)
        .mouseZoomable(false)
        .brushOn(true)
        .elasticY(true)
        .renderHorizontalGridLines(true)
        .legend(dc.legend().x(450).y(0).itemHeight(13).gap(5));

      var brush       = composite.brush();
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

      rowChart
        .width(500).height(300)
        .margins({top: 30, right: 30, bottom: 30, left: 30})
        .dimension(platformsDim)
        .group(platformsDim.group())
        .colors(['#3182BD'])
        .ordering(function(d) { return -d.value })
        .elasticX(true);

      mimesChart
        .width(300).height(300)
        .dimension(mimeDim)
        .group(mimeDim.group())
        .innerRadius(50)
        .label(function (d) {
          return d.data.key + ' (' + d.data.value + ')';
        });

      rtypesChart
        .width(300).height(300)
        .dimension(rtypeDim)
        .group(rtypeDim.group())
        .innerRadius(50)
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

      var updateDatatable = function () {
        var tbody = $('#data-table tbody').empty();
        var tfoot = $('#data-table tfoot').empty();

        titleDim.group().top(11).forEach(function (title) {
          var tr = $('<tr></tr>');

          if (title.key) {
            tr.append($('<td></td>').text(title.key));
            tr.append($('<td></td>').text(title.value));
            tbody.append(tr);
          } else {
            tr.append($('<td></td>').text('Title not available'));
            tr.append($('<td></td>').text(title.value));
            tfoot.append(tr);
          }
        });
      };
      updateDatatable();

      rowChart.on('filtered', updateDatatable);
      mimesChart.on('filtered', updateDatatable);
      rtypesChart.on('filtered', updateDatatable);
      composite.on('filtered', updateDatatable);

      if (geoAvailable) {
        geoChart.on('filtered', updateDatatable);
        zoom("#choropleth-chart");
      }

      $('.step-0, .step-1').hide();
      $('.step-2').show();
      launcher.prop('disabled', false);
    });
  }

  launcher.click(readFile);
  restarter.click(function () {
    $('.step-1, .step-2').hide();
    $('.step-0').show();
  });
});