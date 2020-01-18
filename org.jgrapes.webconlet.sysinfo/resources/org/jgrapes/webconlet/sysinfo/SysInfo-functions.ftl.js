/*
 * JGrapes Event Driven Framework
 * Copyright (C) 2016, 2020  Michael N. Lipp
 *
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU Affero General Public License as published by 
 * the Free Software Foundation; either version 3 of the License, or 
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License 
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License along 
 * with this program; if not, see <http://www.gnu.org/licenses/>.
 */

'use strict';

var orgJGrapesPortletsSysInfo = {
    };

(function() {

    $("body").on("click", ".jgrapes-portlets-sysinfo-view .GarbageCollection-action",
            function(event) {
        let portletId = $(this).closest("[data-portlet-id]").attr("data-portlet-id");
        JGPortal.notifyPortletModel(portletId, "garbageCollection");
    })

    let timeData = [];
    let maxMemoryData = [];
    let totalMemoryData = [];
    let usedMemoryData = [];
    
    JGPortal.registerPortletMethod(
            "org.jgrapes.webconlet.sysinfo.SysInfoConlet",
            "updateMemorySizes", function(portletId, params) {
                if (timeData.length >= 301) {
                    timeData.shift();
                    maxMemoryData.shift();
                    totalMemoryData.shift();
                    usedMemoryData.shift();
                }
                timeData.push(params[0]);
                maxMemoryData.push(params[1]);
                totalMemoryData.push(params[2]);
                usedMemoryData.push(params[3]);
                let maxFormatted = "";
                let totalFormatted = "";
                let usedFormatted = "";
                let portlet = JGPortal.renderer.findPortletPreview(portletId);
                let lang = 'en';
                if (portlet) {
                    portlet = $(portlet);
                    lang = portlet.closest('[lang]').attr('lang') || 'en'
                    maxFormatted = JGPortal.renderer.formatMemorySize(params[1], 1, lang);
                    totalFormatted = JGPortal.renderer.formatMemorySize(params[2], 1, lang);
                    usedFormatted = JGPortal.renderer.formatMemorySize(params[3], 1, lang);
                    let col = portlet.find(".maxMemory");
                    col.html(maxFormatted);
                    col = portlet.find(".totalMemory");
                    col.html(totalFormatted);
                    col = portlet.find(".usedMemory");
                    col.html(usedFormatted);
                }
                portlet = JGPortal.renderer.findPortletView(portletId);
                if (portlet) {
                    portlet = $(portlet);
                    let col = portlet.find(".maxMemory");
                    col.html(maxFormatted);
                    col = portlet.find(".totalMemory");
                    col.html(totalFormatted);
                    col = portlet.find(".usedMemory");
                    col.html(usedFormatted);
                    let chartCanvas = portlet.find(".memoryChart");
                    if (portlet.find(".memoryChart").parent(":hidden").length === 0) {
                        let chart = chartCanvas.data('chartjs-chart');
                        if (chart) {
                            moment.locale(lang);
                            chart.update(0);
                        }
                    }
                }
            });

    orgJGrapesPortletsSysInfo.initMemoryChart = function(content) {
        let chartCanvas = $(content).find(".memoryChart");
        let ctx = chartCanvas[0].getContext('2d');
        let lang = chartCanvas.closest('[lang]').attr('lang') || 'en'
        let chart = new Chart(ctx, {
            // The type of chart we want to create
            type: 'line',

            // The data for our datasets
            data: {
                labels: timeData,
                datasets: [{
                    lineTension: 0,
                    fill: false,
                    borderWidth: 2,
                    pointRadius: 1,
                    borderColor: "rgba(255,0,0,1)",
                    label: '${_("maxMemory")}',
                    data: maxMemoryData,
                },{
                    lineTension: 0,
                    fill: false,
                    borderWidth: 2,
                    pointRadius: 1,
                    borderColor: "rgba(255,165,0,1)",
                    label: '${_("totalMemory")}',
                    data: totalMemoryData,
                },{
                    lineTension: 0,
                    fill: false,
                    borderWidth: 2,
                    pointRadius: 1,
                    borderColor: "rgba(0,255,0,1)",
                    label: '${_("usedMemory")}',
                    data: usedMemoryData,
                }]
            },

            // Configuration options go here
            options: {
                maintainAspectRatio: false,
                scales: {
                    xAxes: [{
                        type: 'time',
                        distribution: 'linear',
                        time: {
                            displayFormats: {
                                millisecond: 'LTS',
                                second: 'LTS',
                            }
                        }
                    }],
                    yAxes: [{
                        ticks: {
                            callback: function(value, index, values) {
                                return JGPortal.renderer.formatMemorySize(value, 0, lang);
                            }
                        }
                    }]
                }
            }
        });
        chartCanvas.data('chartjs-chart', chart);
    }
    
})();
