// ==UserScript==
// @name         Extra Airport Runways
// @namespace    http://tampermonkey.net/
// @version      2026-04-18
// @description  Extra Runways (Optimized)
// @author       CES2731/Deepseek
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
        GRID_DATA_URL: 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/runways.json',
        ILS_DATA_URL: 'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/ilsdata.json'
    };
    // ====================================================

    // ---------- 工具函数 ----------
    const fetchWithTimeout = (url, timeout = 15000) => {
        return Promise.race([
            fetch(url),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`请求超时 (${timeout}ms)`)), timeout)
            )
        ]);
    };

    // ---------- 第一部分：跑道网格数据加载 ----------
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
            const response = await fetchWithTimeout(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const json = await response.json();
            const added = parseAndAddToGrid(json);
            console.log(`✅ 跑道网格数据加载完成，共添加 ${added} 条`);
        } catch (err) {
            console.error('❌ 跑道网格数据加载失败:', err);
        }
    }

    // ---------- 第二部分：ILS/RNW 导航及地图标记加载（优化分批处理） ----------
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
            // 日志改为调试级别，避免刷屏（保留少量）
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
            // 日志精简
        }

        return addedNav;
    }

    // 分批处理函数，避免长时间阻塞 UI
    async function processInBatches(items, batchSize, processor) {
        let successCount = 0;
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            for (const item of batch) {
                try {
                    const result = processor(item);
                    if (result) successCount++;
                } catch (e) {
                    // 单个失败不影响整体
                }
            }
            // 让出主线程
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        return successCount;
    }

    async function loadILSData(url) {
        console.log(`🚀 正在加载 ILS/RNW 数据: ${url}`);
        try {
            const response = await fetchWithTimeout(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (!Array.isArray(data)) {
                console.error('❌ JSON 格式错误：应为数组');
                return;
            }

            const total = data.length;
            console.log(`📡 共 ${total} 条 ILS/RNW 记录，开始分批处理...`);

            const successCount = await processInBatches(data, 50, (item) => {
                return addCustomRunway(item);
            });

            console.log(`🎉 ILS/RNW 数据导入完成！成功添加 ${successCount}/${total} 条`);
        } catch (error) {
            console.error('❌ ILS/RNW 数据加载失败:', error.message);
        }
    }

    // 刷新地图（优化版：只触发一次刷新）
    function refreshMap() {
        // 优先使用官方 API
        if (geofs.api && geofs.api.map && typeof geofs.api.map.updateMarkerLayers === 'function') {
            geofs.api.map.updateMarkerLayers();
            console.log('🔄 已调用地图标记更新 API');
            return;
        }
        // 备选：移动飞机一次
        if (geofs.aircraft && geofs.aircraft.instance) {
            const pos = geofs.aircraft.instance.getPosition();
            if (pos) {
                geofs.aircraft.instance.setPosition({ lat: pos.lat + 0.001, lng: pos.lng, alt: pos.alt });
                setTimeout(() => {
                    geofs.aircraft.instance.setPosition(pos);
                }, 100);
                console.log('🔄 已轻微移动飞机以触发地图刷新');
            }
        }
    }

    // ---------- 主执行流程（并行加载，合并刷新） ----------
    (async function main() {
        console.log('🔧 合并插件启动（优化版），配置:', CONFIG);

        try {
            // 并行加载两个数据源
            const gridPromise = CONFIG.GRID_DATA_URL ? loadGridData(CONFIG.GRID_DATA_URL) : Promise.resolve();
            const ilsPromise = CONFIG.ILS_DATA_URL ? loadILSData(CONFIG.ILS_DATA_URL) : Promise.resolve();

            await Promise.all([gridPromise, ilsPromise]);

            // 所有加载完成后统一刷新地图
            refreshMap();
            console.log('✅ 所有数据加载完成，地图已刷新');
        } catch (error) {
            console.error('❌ 插件执行过程中发生未捕获错误:', error);
        }
    })();

    // 暴露全局方法（可选）
    window.addCustomRunway = addCustomRunway;
    window.loadILSData = loadILSData;
    window.loadGridData = loadGridData;
})();
