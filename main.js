// ==UserScript==
// @name         GeoFS-Extra-Airports-Runway
// @namespace    http://tampermonkey.net/
// @version      2026-04-17
// @description  Extra-Airports-Runway
// @author       CES2731
// @match        https://beta.geo-fs.com/geofs.php?v=4
// @icon         https://www.google.com/s2/favicons?sz=64&domain=geo-fs.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ==================== RUNWAYS JSON ====================
    const RUNWAYS_JSON_URL = 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/runways.json';

    // ==================== ILS JSON ====================
    const ILS_JSON_URL = 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/ilsdata.json';

    // ==================== 等待 GeoFS ====================
    function waitGeoFS(callback) {
        const t = setInterval(() => {
            if (
                typeof geofs !== 'undefined' &&
                geofs.majorRunwayGrid &&
                geofs.nav &&
                geofs.map
            ) {
                clearInterval(t);
                console.log("✅ GeoFS 已加载完成");
                callback();
            }
        }, 1000);
    }

    // =========================================================
    // ==================== RUNWAY SYSTEM ======================
    // =========================================================
    function runRunwaySystem() {

        function getGridKey(coord) {
            let key = Math.trunc(coord);
            if (key === -0) key = 0;
            return String(key);
        }

        function findClosestRunwayGrid(lat, lon) {
            const EARTH_RADIUS = 6371;
            const toRad = Math.PI / 180;
            let minDist = Infinity;
            let targetLatKey = null, targetLonKey = null;

            for (const [latKey, lonGrid] of Object.entries(geofs.majorRunwayGrid)) {
                for (const [lonKey, runways] of Object.entries(lonGrid)) {
                    for (const r of runways) {
                        const rLat = r[4], rLon = r[5];
                        if (rLat === undefined || rLon === undefined) continue;

                        const dLat = (rLat - lat) * toRad;
                        const dLon = (rLon - lon) * toRad;

                        const a =
                            Math.sin(dLat/2)**2 +
                            Math.cos(lat*toRad)*Math.cos(rLat*toRad) *
                            Math.sin(dLon/2)**2;

                        const dist = EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

                        if (dist < minDist) {
                            minDist = dist;
                            targetLatKey = latKey;
                            targetLonKey = lonKey;
                        }
                    }
                }
            }

            return { latKey: targetLatKey, lonKey: targetLonKey };
        }

        function addRunway(icao, length, width, heading, lat, lon, elevation = 0) {

            if (!icao || typeof icao !== 'string') return false;

            let latKey = getGridKey(lat);
            let lonKey = getGridKey(lon);

            const nearest = findClosestRunwayGrid(lat, lon);
            if (nearest.latKey && nearest.lonKey) {
                latKey = nearest.latKey;
                lonKey = nearest.lonKey;
            }

            if (!geofs.majorRunwayGrid[latKey]) geofs.majorRunwayGrid[latKey] = {};
            if (!geofs.majorRunwayGrid[latKey][lonKey]) geofs.majorRunwayGrid[latKey][lonKey] = [];

            const exists = geofs.majorRunwayGrid[latKey][lonKey]
                .some(r => r[0] === icao && Math.abs(r[4]-lat) < 0.001);

            if (exists) return false;

            const runway = [icao, length, width, heading, lat, lon];
            if (elevation !== 0) runway.push(elevation);

            geofs.majorRunwayGrid[latKey][lonKey].push(runway);

            console.log(`✅ ${icao}`);
            return true;
        }

        function addBatch(runwaysArray) {
            let success = 0;
            for (const r of runwaysArray) {
                if (addRunway(r[0], r[1], r[2], r[3], r[4], r[5], r[6] || 0)) {
                    success++;
                }
            }
            console.log(`📊 Runways: ${success}/${runwaysArray.length}`);
        }

        function parseAndAdd(data) {
            let runwaysArray = [];

            if (Array.isArray(data)) {
                if (Array.isArray(data[0])) {
                    runwaysArray = data;
                } else {
                    runwaysArray = data.map(i =>
                        [i.icao, i.length, i.width, i.heading, i.lat, i.lon, i.elevation || 0]
                    );
                }
            } else if (data.runways) {
                runwaysArray = data.runways.map(i =>
                    [i.icao, i.length, i.width, i.heading, i.lat, i.lon, i.elevation || 0]
                );
            }

            addBatch(runwaysArray);
        }

        fetch(RUNWAYS_JSON_URL)
            .then(r => r.json())
            .then(json => {
                parseAndAdd(json);
                console.log("🎉 Runways loaded");
            });
    }

    // =========================================================
    // ==================== ILS SYSTEM =========================
    // =========================================================
    function runILSSystem() {

        function addCustomRunway(options) {

            const base = {
                icao: options.icao,
                ident: options.ident,
                name: `${options.icao}|${options.ident}|${options.icao}`,
                lat: parseFloat(options.lat),
                lon: parseFloat(options.lon),
                heading: parseFloat(options.heading),
                lengthFeet: options.lengthFt || 10000,
                widthFeet: options.widthFt || 150,
                major: options.major !== false,
                freq: options.freq,
                slope: options.slope || 3.0,
                type: 'RNW'
            };

            const addedNav = geofs.nav.addNavaid(Object.assign({}, base));

            if (options.freq) {

                const ilsData = Object.assign({}, base, {
                    type: 'ILS',
                    ident: options.ident + 'X'
                });

                const addedILS = geofs.nav.addNavaid(ilsData);

                if (!geofs.nav.frequencies[options.freq]) {
                    geofs.nav.frequencies[options.freq] = [];
                }

                geofs.nav.frequencies[options.freq].push(addedILS);
            }

            if (geofs.map?.addRunwayMarker) {
                if (addedNav.marker) addedNav.marker.destroy();
                geofs.map.addRunwayMarker(base);
            }

            if (geofs.api?.map?.updateMarkerLayers) {
                geofs.api.map.updateMarkerLayers();
            }
        }

        fetch(ILS_JSON_URL)
            .then(r => r.json())
            .then(data => {
                data.forEach(addCustomRunway);
                console.log("🎉 ILS loaded");
            });
    }

    // ==================== START ====================
    waitGeoFS(() => {
        runRunwaySystem();
        runILSSystem();
    });

})();
