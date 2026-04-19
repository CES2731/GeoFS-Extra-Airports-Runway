// ==UserScript==
// @name         GeoFS Extra Runways (Full Version)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Full integration: Physics, ILS, Markers, and Interactive Creator
// @author       CES2731
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Guard clause for GeoFS environment
    if (typeof geofs === 'undefined' || !geofs.cesium) {
        console.error("❌ GeoFS not detected. Plugin failed to load.");
        return;
    }

    const CONFIG = {
        GRID_DATA_URL: 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/runways.json',
        NAV_DATA_URL: 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/ilsdata.json',
        ISSUE_URL: 'https://github.com/CES2731/GeoFS-Extra-Airports-Runway/issues/new',
        DEFAULT_WIDTH: 150
    };

    const viewer = geofs.cesium.viewer;

    // --- GEOSPATIAL ENGINE ---
    const GeoEngine = {
        getHeading: (p1, p2) => {
            const toRad = Math.PI / 180;
            const y = Math.sin((p2.lon - p1.lon) * toRad) * Math.cos(p2.lat * toRad);
            const x = Math.cos(p1.lat * toRad) * Math.sin(p2.lat * toRad) -
                      Math.sin(p1.lat * toRad) * Math.cos(p2.lat * toRad) * Math.cos((p2.lon - p1.lon) * toRad);
            return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        },
        getDistance: (p1, p2) => {
            const c1 = Cesium.Cartesian3.fromDegrees(p1.lon, p1.lat);
            const c2 = Cesium.Cartesian3.fromDegrees(p2.lon, p2.lat);
            return Cesium.Cartesian3.distance(c1, c2) * 3.28084; // Convert to Feet
        },
        getGridKey: (coord) => {
            let key = Math.trunc(coord);
            return String(key === -0 ? 0 : key);
        }
    };

    // --- CORE MANAGERS ---
    const RunwayManager = {
        // Adds runway to the physics engine so wheels interact with ground
        injectToPhysics: function(icao, length, width, heading, lat, lon, elev = 0) {
            const latKey = GeoEngine.getGridKey(lat);
            const lonKey = GeoEngine.getGridKey(lon);
            
            geofs.majorRunwayGrid[latKey] = geofs.majorRunwayGrid[latKey] || {};
            geofs.majorRunwayGrid[latKey][lonKey] = geofs.majorRunwayGrid[latKey][lonKey] || [];
            
            const runwayArray = [icao, Math.round(length), width, Number(heading.toFixed(2)), lat, lon, Math.round(elev)];
            geofs.majorRunwayGrid[latKey][lonKey].push(runwayArray);
        },

        // Adds ILS/Radio and Map Icons
        injectToNav: function(data) {
            const rnwData = {
                icao: data.icao || "CUST",
                ident: data.ident || "00",
                name: `${data.icao}|${data.ident || "00"}|${data.icao}`,
                lat: parseFloat(data.lat),
                lon: parseFloat(data.lon),
                heading: parseFloat(data.heading),
                lengthFeet: data.length || 10000,
                widthFeet: data.width || 150,
                freq: data.freq || null,
                slope: data.slope || 3.0,
                type: 'RNW'
            };

            const addedNav = geofs.nav.addNavaid(rnwData);

            // Handle Map Marker
            if (geofs.map && geofs.map.addRunwayMarker) {
                if (addedNav.marker) addedNav.marker.destroy();
                addedNav.marker = geofs.map.addRunwayMarker(rnwData);
            }

            // Handle ILS Station
            if (data.freq) {
                const ilsData = { ...rnwData, ident: rnwData.ident + 'X', name: rnwData.icao + ' ILS', type: 'ILS' };
                const addedILS = geofs.nav.addNavaid(ilsData);
                geofs.nav.frequencies[data.freq] = geofs.nav.frequencies[data.freq] || [];
                geofs.nav.frequencies[data.freq].push(addedILS);
            }
        },

        // Visual 3D Surface
        render3D: function(icao, p1, p2, width, altM) {
            return viewer.entities.add({
                name: `RWY_FULL_${icao}`,
                corridor: {
                    positions: Cesium.Cartesian3.fromDegreesArray([p1.lon, p1.lat, p2.lon, p2.lat]),
                    width: width * 0.3048,
                    height: altM,
                    extrudedHeight: altM - 1.2,
                    material: Cesium.Color.fromCssColorString('#111111').withAlpha(0.95),
                    outline: true,
                    outlineColor: Cesium.Color.WHITE
                }
            });
        }
    };

    // --- INTERACTIVE TOOL ---
    window.geofsRunwayTool = {
        create: function(icao, ident, freq, width = CONFIG.DEFAULT_WIDTH) {
            console.log(`%c[CREATION MODE] Click the START and END center points of the runway for ${icao}`, "color: yellow; font-weight: bold;");
            let points = [];
            const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

            handler.setInputAction((click) => {
                const ray = viewer.camera.getPickRay(click.position);
                const cartesian = viewer.scene.globe.pick(ray, viewer.scene);

                if (cartesian) {
                    const carto = Cesium.Cartographic.fromCartesian(cartesian);
                    points.push({ lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) });
                    console.log(`📍 Point ${points.length} confirmed.`);

                    if (points.length === 2) {
                        const length = GeoEngine.getDistance(points[0], points[1]);
                        const heading = GeoEngine.getHeading(points[0], points[1]);
                        const altM = geofs.aircraft.instance.llaLocation[2];
                        
                        const runwayObj = {
                            icao, ident, 
                            length: Math.round(length), 
                            width, 
                            heading: Number(heading.toFixed(2)), 
                            lat: Number(((points[0].lat + points[1].lat) / 2).toFixed(6)), 
                            lon: Number(((points[0].lon + points[1].lon) / 2).toFixed(6)), 
                            elevation: Math.round(altM * 3.2808), 
                            freq: freq || null
                        };

                        // Immediate Preview
                        RunwayManager.render3D(icao, points[0], points[1], width, altM);
                        RunwayManager.injectToPhysics(runwayObj.icao, runwayObj.length, runwayObj.width, runwayObj.heading, runwayObj.lat, runwayObj.lon, runwayObj.elevation);
                        RunwayManager.injectToNav(runwayObj);

                        // Clipboard and Submission
                        const jsonStr = JSON.stringify(runwayObj, null, 2);
                        const textarea = document.createElement("textarea");
                        textarea.value = jsonStr; document.body.appendChild(textarea);
                        textarea.select(); document.execCommand('copy');
                        document.body.removeChild(textarea);

                        console.log("JSON Generated:", jsonStr);
                        if (confirm(`Runway ${icao} created! Data copied to clipboard.\n\nWould you like to open GitHub to submit this for review?`)) {
                            window.open(`${CONFIG.ISSUE_URL}?title=[Submission] ${icao}&body=${encodeURIComponent("Please paste the JSON below:\n\n```json\n" + jsonStr + "\n```")}`, '_blank');
                        }
                        handler.destroy();
                    }
                }
            }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
        },

        syncData: async function() {
            console.log("☁️ Synchronizing runway and navigation databases...");
            try {
                // Fetch Physics Data
                const resGrid = await fetch(CONFIG.GRID_DATA_URL);
                const gridJSON = await resGrid.json();
                const gridList = Array.isArray(gridJSON) ? gridJSON : (gridJSON.runways || []);
                gridList.forEach(r => {
                    if (Array.isArray(r)) RunwayManager.injectToPhysics(...r);
                    else RunwayManager.injectToPhysics(r.icao, r.length, r.width, r.heading, r.lat, r.lon, r.elevation || 0);
                });

                // Fetch Nav/ILS Data
                const resNav = await fetch(CONFIG.NAV_DATA_URL);
                const navJSON = await resNav.json();
                navJSON.forEach(n => RunwayManager.injectToNav(n));

                if (geofs.api.map && geofs.api.map.updateMarkerLayers) geofs.api.map.updateMarkerLayers();
                console.log(`✅ Sync Complete: ${gridList.length} Runways and ${navJSON.length} Nav stations loaded.`);
            } catch (error) {
                console.error("❌ Sync Error:", error);
            }
        }
    };

    // Execute Sync on startup
    window.geofsRunwayTool.syncData();
})();
