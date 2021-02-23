/*
 * JGrapes Event Driven Framework
 * Copyright (C) 2019  Michael N. Lipp
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

import Vue from "../../page-resource/vue/vue.esm.browser.js"
import { jgwcIdScopeMixin } from "../../page-resource/jgwc-vue-components/jgwc-components.js";
import "../../page-resource/jgwc-vue-components/jgwc_vue_components.umd.js";

const l10nBundles = {
    // <#list supportedLanguages() as l>
    '${l.locale.toLanguageTag()}': {
        // <#list l.l10nBundle.keys as key>
        '${key}': '${l.l10nBundle.getString(key)}',
        // </#list>
    },
    // </#list>    
};

window.orgJGrapesOsgiConletStyleTest = {};

window.orgJGrapesOsgiConletStyleTest.initView = function(content) {
    new Vue({
        mixins: [jgwcIdScopeMixin],
        el: $(content)[0],
        data: {
            conletId: $(content).closest("[data-conlet-id]").data("conlet-id"),
            controller: new JGConsole.TableController([
                ["year", 'Year'],
                ["month", 'Month'],
                ["title", 'Title'],
                ], {
                sortKey: "year"
            }),
            detailsByKey: {},
            issues: [
                { year: 2019, month: 6, title: "Middle of year" },
                { year: 2019, month: 12, title: "End of year" },
                { year: 2020, month: 1, title: "A new year begins" },
            ],
        },
        computed: {
            filteredData: function() {
                let infos = Object.values(this.issues);
                return this.controller.filter(infos);
            }
        },
        methods: {
            localize: function(key) {
                return JGConsole.localize(
                    l10nBundles, this.jgwc.observed.lang, key);
            }
        }
    }).JGConsole = window.JGConsole;
}
