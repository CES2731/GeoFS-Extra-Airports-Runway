// ==UserScript==
// @name         Extra Airport Runways
// @namespace    http://tampermonkey.net/
// @version      2026-11-26
// @description  Extra Runways (Optimized, compatible with the 2026-11 GeoFS map update)
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
        ILS_DATA_URLS: [
            'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/ilsdata.json',
            'https://raw.githubusercontent.com/CES2731/GeoFS-Extra-Airports-Runway/refs/heads/main/ilsdata2.json'
            ]
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

    // ---------- GeoFS 新版地图 API 兼容层 ----------
    // 2026-11 的地图 UI 更新后，跑道的显示方式改成了“先注册、再按瓦片渲染”：
    //   1. 必须调用 geofs.map.addRunwayMarker(runway) 把跑道写进 major / minor 图层的数据表；
    //   2. 只有 geofs.api.map.updateMarkerLayers() 命中可见瓦片时，才会真正生成 Leaflet 标记；
    //   3. 地图标记不再从 geofs.majorRunwayGrid 自动生成 —— 只往网格里塞数据，地图上不会出现任何东西。
    // 另外新版 geofs.nav.addNavaid() 自己会顺手创建 navaid 图标标记，并写入 frequencies。
    // 同时 GeoFS 的脚本是延迟加载的，插件常常比 geofs.map / geofs.majorRunwayGrid 更早执行，
    // 所以这里统一做“等 API 就绪 → 再注册”，避免静默失败。
    const pendingMapTasks = [];

    function waitFor(predicate, timeout, timeoutMessage) {
        let ok = false;
        try { ok = !!predicate(); } catch (err) { ok = false; }
        if (ok) return Promise.resolve(true);
        return new Promise(resolve => {
            const start = Date.now();
            const timer = setInterval(() => {
                let ready = false;
                try { ready = !!predicate(); } catch (err) { ready = false; }
                if (ready) {
                    clearInterval(timer);
                    resolve(true);
                } else if (Date.now() - start >= timeout) {
                    clearInterval(timer);
                    if (timeoutMessage) console.warn(timeoutMessage);
                    resolve(false);
                }
            }, 1000);
        });
    }

    const isRunwayGridReady = () => !!(geofs && geofs.majorRunwayGrid);
    const isMapApiReady = () => !!(
        geofs &&
        geofs.nav && typeof geofs.nav.addNavaid === 'function' &&
        geofs.map && typeof geofs.map.addRunwayMarker === 'function' &&
        geofs.api && geofs.api.map && geofs.api.map.markerLayers && geofs.api.map._map
    );

    // 地图 API 就绪前先排队，就绪后再执行；已就绪则立即执行
    function runWhenMapReady(task) {
        if (isMapApiReady()) {
            try {
                return task();
            } catch (err) {
                console.warn('⚠️ 地图注册任务失败:', err);
                return null;
            }
        }
        pendingMapTasks.push(task);
        return null;
    }

    async function flushMapTasks(timeout = 300000) {
        if (!pendingMapTasks.length) return 0;
        const ready = await waitFor(isMapApiReady, timeout, '⏳ 等待 GeoFS 地图 API 超时，跑道暂时不会显示在地图上');
        if (!ready) return 0;
        const tasks = pendingMapTasks.splice(0, pendingMapTasks.length);
        let count = 0;
        for (const task of tasks) {
            try {
                task();
                count++;
            } catch (err) {
                console.warn('⚠️ 地图注册任务失败:', err);
            }
        }
        console.log(`🗺️ 地图图层注册完成：${count} / ${tasks.length}`);
        return count;
    }

    // 新版跑道弹窗按 "跑道号|名称|ICAO" 解析名称，第 3 段用于查询塔台/ATIS 频率
    function makeRunwayName(ident, icao) {
        return `${ident}|${icao}|${icao}`;
    }

    function registerRunwayNow(runwayData) {
        let addedNav = null;
        try {
            addedNav = geofs.nav.addNavaid(runwayData);
        } catch (err) {
            console.warn('⚠️ 跑道导航数据注册失败:', runwayData.name, err);
            return null;
        }
        // 新版 addNavaid 可能会顺手创建一个图标标记（RNW 类型没有图标，返回 undefined）
        if (addedNav && addedNav.marker && typeof addedNav.marker.destroy === 'function') {
            addedNav.marker.destroy();
            addedNav.marker = null;
        }
        try {
            geofs.map.addRunwayMarker(runwayData);
        } catch (err) {
            console.warn('⚠️ 跑道地图标记注册失败:', runwayData.name, err);
        }
        return addedNav;
    }

    function registerRunwayOnMap(runwayData) {
        if (!isMapApiReady()) {
            // 地图 API 尚未初始化：先排队，等就绪后统一注册（返回跑道对象表示已受理）
            pendingMapTasks.push(() => registerRunwayNow(runwayData));
            return runwayData;
        }
        return registerRunwayNow(runwayData);
    }

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

    // 网格里的首项通常形如 "ZGSZ16L34R"（ICAO + 跑道编号），拆开才能填进新版跑道标记
    function splitGridName(name) {
        const text = String(name == null ? '' : name).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const match = text.match(/^([A-Z0-9]{4})(.+)$/);
        if (match && match[2]) return { icao: match[1], ident: match[2] };
        return { icao: text || 'CUST', ident: text || '00' };
    }

    // 把网格跑道同步注册到新版地图图层（否则 3D 跑道有了，地图上却没有标记）
    function registerGridRunwayOnMap(runwayRecord) {
        const [name, length, width, heading, lat, lon] = runwayRecord;
        const { icao, ident } = splitGridName(name);
        registerRunwayOnMap({
            id: null,
            icao: icao,
            ident: ident,
            name: makeRunwayName(ident, icao),
            lat: lat,
            lon: lon,
            heading: heading,
            lengthFeet: length,
            widthFeet: width,
            major: true,
            freq: undefined,
            slope: 3.0,
            type: 'RNW'
        });
    }

    function addBatchToGrid(runwaysArray) {
        let success = 0;
        for (const r of runwaysArray) {
            if (addRunwayToGrid(r[0], r[1], r[2], r[3], r[4], r[5], r[6] || 0)) {
                success++;
                registerGridRunwayOnMap(r);
            }
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
            const response = await fetchWithTimeout(url, 30000);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const json = await response.json();
            const added = parseAndAddToGrid(json);
            console.log(`✅ 跑道网格数据加载完成，共添加 ${added} 条`);
        } catch (err) {
            console.error('❌ 跑道网格数据加载失败:', err);
        }
    }

    // ---------- 第二部分：ILS/RNW 导航及地图标记加载（优化分批处理） ----------
    const registeredKeys = new Set();

    function runwayKey(icao, ident, lat, lon) {
        return [icao, ident, Number(lat).toFixed(4), Number(lon).toFixed(4)].join('|');
    }

    function addCustomRunway(options) {
        const icao = String(options.icao || 'CUST').toUpperCase();
        const ident = String(options.ident || '00').toUpperCase();
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

        const key = runwayKey(icao, ident, lat, lon);
        if (registeredKeys.has(key)) return null;
        registeredKeys.add(key);

        const runwayData = {
            id: null,
            icao: icao,
            ident: ident,
            name: makeRunwayName(ident, icao),
            lat: lat,
            lon: lon,
            heading: heading,
            lengthFeet: lengthFt,
            widthFeet: widthFt,
            major: major,
            freq: freq || undefined,
            slope: slope,
            type: 'RNW'
        };

        // 新版：导航数据与地图标记必须一起注册，否则地图上不会出现跑道
        const addedNav = registerRunwayOnMap(runwayData);

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
            // 新版 addNavaid 会自动把 ILS 写进 geofs.nav.frequencies，这里不再手动 push
            runWhenMapReady(() => {
                try {
                    geofs.nav.addNavaid(ilsData);
                } catch (err) {
                    console.warn('⚠️ ILS 导航数据注册失败:', ilsData.name, err);
                }
            });
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
            const response = await fetchWithTimeout(url, 30000);
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
        if (geofs.api && geofs.api.map && geofs.api.map._map && typeof geofs.api.map.updateMarkerLayers === 'function') {
            geofs.api.map.updateMarkerLayers();
            if (geofs.map && typeof geofs.map.resize === 'function' && geofs.map.mapActive) {
                geofs.map.resize();
            }
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
            // 网格数据必须等 geofs.majorRunwayGrid 就绪（GeoFS 的脚本是延迟加载的）
            const gridPromise = (async () => {
                if (!CONFIG.GRID_DATA_URL) return;
                const ready = await waitFor(isRunwayGridReady, 300000, '⏳ 等待 GeoFS 跑道网格超时，跳过网格数据');
                if (!ready) return;
                await loadGridData(CONFIG.GRID_DATA_URL);
            })();

            // 并行加载所有 ILS 数据源
            const ilsPromises = (CONFIG.ILS_DATA_URLS || []).map(url => loadILSData(url));

            await Promise.all([gridPromise, ...ilsPromises]);

            // 地图 API 尚未就绪时，这里会把排队的跑道统一注册到新版地图图层
            await flushMapTasks();

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
