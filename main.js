// ==UserScript==
// @name         Extra Airport Runways
// @namespace    http://tampermonkey.net/
// @version      2026-04-18
// @description  Extra Runways
// @author       CES2731
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=geo-fs.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        GRID_DATA_URL: 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/runways.json',
        ILS_DATA_URL: 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/ilsdata.json'
    };

    function injectStyles() {
        if (document.getElementById('geofs-extra-runway-style')) return;
        const style = document.createElement('style');
        style.id = 'geofs-extra-runway-style';
        style.textContent = `
            @keyframes slideInRight {
                0% { transform: translate(100%, -50%); opacity: 0; }
                100% { transform: translate(-50%, -50%); opacity: 1; }
            }
            @keyframes slideOutLeft {
                0% { transform: translate(-50%, -50%); opacity: 1; }
                100% { transform: translate(-150%, -50%); opacity: 0; }
            }
            .runway-error-box {
                position: fixed;
                top: 50%;
                left: 50%;
                z-index: 999999;
                background: rgba(255, 255, 255, 0.85);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border: 5px solid #000;
                padding: 30px 60px;
                box-shadow: 15px 15px 0px rgba(0,0,0,0.2);
                animation: slideInRight 0.6s cubic-bezier(0.23, 1, 0.32, 1) forwards;
            }
            .runway-error-inner {
                border: 1px solid #000;
                padding: 15px 30px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
            }
            .runway-error-title {
                font-family: "Arial Black", Gadget, sans-serif;
                font-size: 32px;
                font-weight: 900;
                color: #000;
                text-transform: uppercase;
                letter-spacing: -1px;
                line-height: 1;
                margin-bottom: 10px;
            }
            .runway-error-text {
                font-family: Arial, sans-serif;
                font-size: 14px;
                font-weight: bold;
                color: #000;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .runway-error-box.exit {
                animation: slideOutLeft 0.6s cubic-bezier(0.23, 1, 0.32, 1) forwards;
            }
        `;
        document.head.appendChild(style);
    }

    function triggerUINotification(title, message) {
        injectStyles();
        const container = document.createElement('div');
        container.className = 'runway-error-box';
        container.innerHTML = `
            <div class="runway-error-inner">
                <div class="runway-error-title">${title}</div>
                <div class="runway-error-text">${message}</div>
            </div>
        `;
        document.body.appendChild(container);

        // Stay for 3 seconds, then slide out
        setTimeout(() => {
            container.classList.add('exit');
            setTimeout(() => container.remove(), 600);
        }, 3000);
    }

    if (typeof geofs === 'undefined') {
        triggerUINotification('ERROR', 'GeoFS NOT LOADED');
        console.error('GeoFS is undefined. Script halted.');
        return;
    }

    function getGridKey(coord) {
        let key = Math.trunc(coord);
        if (key === -0) key = 0;
        return String(key);
    }

    function findClosestRunwayGrid(lat, lon) {
        const EARTH_RADIUS = 6371;
        const toRad = Math.PI / 180;
        let minDist = Infinity;
        let targetLatKey = null;
        let targetLonKey = null;

        for (const [latKey, lonGrid] of Object.entries(geofs.majorRunwayGrid)) {
            for (const [lonKey, runways] of Object.entries(lonGrid)) {
                for (let i = 0; i < runways.length; i++) {
                    const r = runways[i];
                    const rLat = r[4];
                    const rLon = r[5];
                    if (rLat === undefined || rLon === undefined) continue;

                    const dLat = (rLat - lat) * toRad;
                    const dLon = (rLon - lon) * toRad;
                    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                              Math.cos(lat * toRad) * Math.cos(rLat * toRad) *
                              Math.sin(dLon/2) * Math.sin(dLon/2);
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

    function addRunwayToGrid(icao, length, width, heading, lat, lon, elevation = 0) {
        if (!icao || typeof icao !== 'string') return false;
        if (length <= 0 || width <= 0) return false;

        let latKey = getGridKey(lat);
        let lonKey = getGridKey(lon);

        const nearest = findClosestRunwayGrid(lat, lon);
        if (nearest.latKey && nearest.lonKey) {
            latKey = nearest.latKey;
            lonKey = nearest.lonKey;
        }

        if (!geofs.majorRunwayGrid[latKey]) {
            geofs.majorRunwayGrid[latKey] = {};
        }
        if (!geofs.majorRunwayGrid[latKey][lonKey]) {
            geofs.majorRunwayGrid[latKey][lonKey] = [];
        }

        const grid = geofs.majorRunwayGrid[latKey][lonKey];
        const exists = grid.some(r => r[0] === icao && Math.abs(r[4] - lat) < 0.001 && Math.abs(r[5] - lon) < 0.001);

        if (exists) return false;

        const runway = [icao, length, width, heading, lat, lon];
        if (elevation !== 0) {
            runway.push(elevation);
        }
        grid.push(runway);
        return true;
    }

    function addCustomRunway(options) {
        const icao = options.icao || 'CUST';
        const ident = options.ident || '00';
        const lat = parseFloat(options.lat);
        const lon = parseFloat(options.lon);
        const heading = parseFloat(options.heading);
        const lengthFt = options.lengthFt || 10000;
        const widthFt = options.widthFt || 150;
        const freq = options.freq || null;
        const slope = options.slope || 3.0;
        const major = options.major !== false;

        if (isNaN(lat) || isNaN(lon) || isNaN(heading)) {
            console.error('Invalid parameters for:', icao);
            return null;
        }

        const runwayData = {
            id: null,
            icao: icao,
            ident: ident,
            name: icao + '|' + ident + '|' + icao,
            lat: lat,
            lon: lon,
            heading: heading,
            lengthFeet: lengthFt,
            widthFeet: widthFt,
            major: major,
            freq: freq,
            slope: slope,
            type: 'RNW'
        };

        const addedNav = geofs.nav.addNavaid(Object.assign({}, runwayData));
        runwayData.id = addedNav.id;

        if (geofs.map && typeof geofs.map.addRunwayMarker === 'function') {
            if (addedNav.marker) {
                addedNav.marker.destroy();
            }
            addedNav.marker = geofs.map.addRunwayMarker(runwayData);
        }

        if (freq) {
            const ilsData = {
                icao: icao,
                ident: ident + 'X',
                name: icao + ' ' + ident + ' ILS',
                lat: lat,
                lon: lon,
                heading: heading,
                freq: freq,
                slope: slope,
                type: 'ILS'
            };
            const addedILS = geofs.nav.addNavaid(ilsData);
            if (!geofs.nav.frequencies[freq]) {
                geofs.nav.frequencies[freq] = [];
            }
            geofs.nav.frequencies[freq].push(addedILS);
        }

        if (geofs.api && geofs.api.map && geofs.api.map.updateMarkerLayers) {
            geofs.api.map.updateMarkerLayers();
        }

        return addedNav;
    }

    async function loadGridData(url) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            let runwaysArray = [];

            if (Array.isArray(data)) {
                if (Array.isArray(data[0])) {
                    runwaysArray = data;
                } else {
                    runwaysArray = data.map(i => [i.icao, i.length, i.width, i.heading, i.lat, i.lon, i.elevation || 0]);
                }
            } else if (data.runways) {
                runwaysArray = Array.isArray(data.runways[0]) ? data.runways : data.runways.map(i => [i.icao, i.length, i.width, i.heading, i.lat, i.lon, i.elevation || 0]);
            }

            let success = 0;
            runwaysArray.forEach(r => {
                if (addRunwayToGrid(r[0], r[1], r[2], r[3], r[4], r[5], r[6] || 0)) success++;
            });
            console.log('[Grid] Successfully added ' + success + ' runways.');
        } catch (e) {
            console.error('Grid data load error:', e);
        }
    }

    async function loadILSData(url) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (Array.isArray(data)) {
                data.forEach(item => addCustomRunway(item));
                console.log('[ILS] Data import complete.');
            }
        } catch (e) {
            console.error('ILS data load error:', e);
        }
    }

    function refreshMap() {
        if (geofs.aircraft && geofs.aircraft.instance) {
            const pos = geofs.aircraft.instance.getPosition();
            if (pos) {
                geofs.aircraft.instance.setPosition({ lat: pos.lat + 0.0001, lng: pos.lng, alt: pos.alt });
                setTimeout(() => geofs.aircraft.instance.setPosition(pos), 100);
            }
        }
    }

    (async function main() {
        console.log('Extra Runways Plugin Starting...');
        if (CONFIG.GRID_DATA_URL) await loadGridData(CONFIG.GRID_DATA_URL);
        if (CONFIG.ILS_DATA_URL) await loadILSData(CONFIG.ILS_DATA_URL);
        refreshMap();
    })();

    window.addCustomRunway = addCustomRunway;
})();
