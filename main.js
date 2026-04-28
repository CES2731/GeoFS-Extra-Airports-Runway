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

    if (typeof geofs === 'undefined') {
        console.error('❌ GeoFS 未加载，请在 GeoFS 页面中运行此脚本。');
        return;
    }

    // ==================== 用户配置区域 ====================
    const CONFIG = {
        // 跑道网格数据 URL（用于 geofs.majorRunwayGrid）
        GRID_DATA_URL: 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/runways.json',
        // ILS/RNW 导航及地图标记数据 URL
        ILS_DATA_URL: 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/ilsdata.json'
    };
    // ====================================================

    // ---------- 第一部分：跑道网格数据加载（源自 main (1).js）----------
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
                    const a = Math.sin(dLat/2)**2 + Math.cos(lat*toRad)*Math.cos(rLat*toRad)*Math.sin(dLon/2)**2;
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

        if (!geofs.majorRunwayGrid[latKey]) geofs.majorRunwayGrid[latKey] = {};
        if (!geofs.majorRunwayGrid[latKey][lonKey]) geofs.majorRunwayGrid[latKey][lonKey] = [];

        const exists = geofs.majorRunwayGrid[latKey][lonKey].some(r => r[0] === icao && Math.abs(r[4]-lat) < 0.001 && Math.abs(r[5]-lon) < 0.001);
        if (exists) return false;

        const runway = [icao, length, width, heading, lat, lon];
        if (elevation !== 0) runway.push(elevation);
        geofs.majorRunwayGrid[latKey][lonKey].push(runway);
        return true;
    }

    function addBatchToGrid(runwaysArray) {
        let success = 0;
        for (const r of runwaysArray) {
            if (addRunwayToGrid(r[0], r[1], r[2], r[3], r[4], r[5], r[6] || 0)) success++;
        }
        console.log(`📊 [网格] 成功添加 ${success} / ${runwaysArray.length} 条跑道`);
        return success;
    }

    function parseAndAddToGrid(data) {
        let runwaysArray = [];
        if (Array.isArray(data)) {
            if (data.length === 0) throw new Error('JSON 数组为空');
            if (Array.isArray(data[0])) {
                runwaysArray = data;
            } else if (typeof data[0] === 'object' && data[0].icao) {
                runwaysArray = data.map(item => [item.icao, item.length, item.width, item.heading, item.lat, item.lon, item.elevation || 0]);
            } else {
                throw new Error('不支持的 JSON 数组格式');
            }
        } else if (typeof data === 'object' && data.runways && Array.isArray(data.runways)) {
            const items = data.runways;
            if (items.length === 0) throw new Error('runways 数组为空');
            if (Array.isArray(items[0])) {
                runwaysArray = items;
            } else {
                runwaysArray = items.map(item => [item.icao, item.length, item.width, item.heading, item.lat, item.lon, item.elevation || 0]);
            }
        } else {
            throw new Error('无法解析 JSON 结构');
        }
        return addBatchToGrid(runwaysArray);
    }

    async function loadGridData(url) {
        if (!url) return;
        console.log(`🗺️ 正在加载跑道网格数据: ${url}`);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const json = await response.json();
            const added = parseAndAddToGrid(json);
            console.log(`✅ 跑道网格数据加载完成，共添加 ${added} 条`);
        } catch (err) {
            console.error('❌ 跑道网格数据加载失败:', err);
        }
    }

    // ---------- 第二部分：ILS/RNW 导航及地图标记加载（源自 ilsdataloader.js）----------
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
            console.error(`❌ 跑道参数无效: ${icao} ${ident}`);
            return null;
        }

        const runwayData = {
            id: null,
            icao: icao,
            ident: ident,
            name: `${icao}|${ident}|${icao}`,
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
            const marker = geofs.map.addRunwayMarker(runwayData);
            addedNav.marker = marker;
            console.log(`🗺️ 地图标记已更新: ${icao} ${ident}`);
        }

        if (freq) {
            const ilsData = {
                icao: icao,
                ident: ident + 'X',
                name: `${icao} ${ident} ILS`,
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
            console.log(`📡 ILS 导航台已添加: ${icao} ${ident} | 频率: ${(freq/1000).toFixed(2)} MHz`);
        }

        if (geofs.api.map && geofs.api.map.updateMarkerLayers) {
            geofs.api.map.updateMarkerLayers();
        }

        return addedNav;
    }

    async function loadILSData(url) {
        console.log(`🚀 正在加载 ILS/RNW 数据: ${url}`);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (!Array.isArray(data)) {
                console.error('❌ JSON 格式错误：应为数组');
                return;
            }

            let successCount = 0;
            data.forEach((item, index) => {
                try {
                    const result = addCustomRunway(item);
                    if (result) successCount++;
                } catch (e) {
                    console.warn(`⚠️ 第 ${index + 1} 条数据添加失败:`, e);
                }
            });

            console.log(`🎉 ILS/RNW 数据导入完成！成功添加 ${successCount}/${data.length} 条`);
        } catch (error) {
            console.error('❌ ILS/RNW 数据加载失败:', error.message);
        }
    }

    // 刷新地图辅助函数
    function refreshMap() {
        if (typeof geofs !== 'undefined' && geofs.aircraft && geofs.aircraft.instance) {
            const pos = geofs.aircraft.instance.getPosition();
            if (pos) {
                geofs.aircraft.instance.setPosition({ lat: pos.lat + 0.001, lng: pos.lng, alt: pos.alt });
                setTimeout(() => geofs.aircraft.instance.setPosition(pos), 100);
                console.log('🔄 已轻微移动飞机以触发地图刷新');
            }
        }
        if (typeof map !== 'undefined' && map.setView) {
            const center = map.getCenter();
            map.setView(center, map.getZoom() - 0.1);
            setTimeout(() => map.setView(center, map.getZoom() + 0.1), 50);
        }
    }

    // ---------- 主执行流程 ----------
    (async function main() {
        console.log('🔧 合并插件启动，配置:', CONFIG);

        // 1. 加载跑道网格数据（用于跑道平整和附近跑道检测）
        if (CONFIG.GRID_DATA_URL) {
            await loadGridData(CONFIG.GRID_DATA_URL);
        } else {
            console.warn('⚠️ 未配置 GRID_DATA_URL，跳过跑道网格数据加载');
        }

        // 2. 加载 ILS/RNW 数据（用于导航、地图标记和弹出窗口）
        if (CONFIG.ILS_DATA_URL) {
            await loadILSData(CONFIG.ILS_DATA_URL);
        } else {
            console.warn('⚠️ 未配置 ILS_DATA_URL，跳过 ILS/RNW 数据加载');
        }

        // 3. 刷新地图显示
        refreshMap();
    })();

    // 暴露全局方法（可选）
    window.addCustomRunway = addCustomRunway;
    window.loadILSData = loadILSData;
    window.loadGridData = loadGridData;
})();
