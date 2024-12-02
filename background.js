// قائمة بأنماط URLs المعروفة للإعلانات
const adServerPatterns = [
    "*://*.doubleclick.net/*",
    "*://*.google-analytics.com/*",
    "*://*.facebook.com/tr/*",
    "*://pagead2.googlesyndication.com/*",
    "*://*.adnxs.com/*",
    "*://*.advertising.com/*"
];

// تهيئة الإعدادات الافتراضية
const initializeSettings = async () => {
    const result = await chrome.storage.sync.get(['settings']);
    if (!result.settings) {
        const defaultSettings = {
            enabled: true,
            whitelist: [],
            stats: {
                totalBlocked: 0,
                domBlocked: 0,
                networkBlocked: 0,
                lastReset: new Date().toISOString()
            },
            lastRulesUpdate: new Date().toISOString()
        };
        await chrome.storage.sync.set({ settings: defaultSettings });
    }
};

// التحقق من صحة البيانات المخزنة
const validateStoredData = async () => {
    const result = await chrome.storage.sync.get(['settings']);
    const settings = result.settings || {};
    
    const requiredFields = {
        enabled: true,
        whitelist: [],
        stats: {
            totalBlocked: 0,
            domBlocked: 0,
            networkBlocked: 0,
            lastReset: new Date().toISOString()
        },
        lastRulesUpdate: new Date().toISOString()
    };
    
    let needsUpdate = false;
    
    for (const [key, value] of Object.entries(requiredFields)) {
        if (!(key in settings)) {
            settings[key] = value;
            needsUpdate = true;
        }
    }
    
    if (!settings.stats || typeof settings.stats !== 'object') {
        settings.stats = requiredFields.stats;
        needsUpdate = true;
    } else {
        for (const [key, value] of Object.entries(requiredFields.stats)) {
            if (!(key in settings.stats)) {
                settings.stats[key] = value;
                needsUpdate = true;
            }
        }
    }
    
    if (needsUpdate) {
        await chrome.storage.sync.set({ settings });
    }
    
    return settings;
};

// تحديث الإحصائيات
const updateStats = async (type) => {
    const settings = await validateStoredData();
    
    settings.stats.totalBlocked++;
    if (type === 'dom') {
        settings.stats.domBlocked++;
    } else if (type === 'network') {
        settings.stats.networkBlocked++;
    }
    
    await chrome.storage.sync.set({ settings });
    updateBadge(settings.stats.totalBlocked);
};

// تحديث شارة الإضافة
const updateBadge = (count) => {
    chrome.action.setBadgeText({ text: count.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
};

// التحقق من القائمة البيضاء
const isWhitelisted = async (url) => {
    try {
        const settings = await validateStoredData();
        const hostname = new URL(url).hostname;
        return settings.whitelist.some(domain => 
            hostname === domain || hostname.endsWith(`.${domain}`)
        );
    } catch (error) {
        console.error('Error checking whitelist:', error);
        return false;
    }
};

// تحميل وتحديث قواعد منع الإعلانات
const updateRules = async () => {
    try {
        const settings = await validateStoredData();
        
        const lastUpdate = new Date(settings.lastRulesUpdate);
        const now = new Date();
        if (now - lastUpdate < 24 * 60 * 60 * 1000) {
            return;
        }
        
        const response = await fetch(chrome.runtime.getURL('rules.json'));
        const rules = await response.json();
        
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: rules.map((_, index) => index + 1),
            addRules: rules.map((rule, index) => ({
                ...rule,
                id: index + 1
            }))
        });
        
        settings.lastRulesUpdate = now.toISOString();
        await chrome.storage.sync.set({ settings });
    } catch (error) {
        console.error('Error updating rules:', error);
    }
};

// إعداد التحديث الدوري للقواعد
const setupPeriodicRulesUpdate = () => {
    chrome.alarms.clear('updateRules', () => {
        chrome.alarms.create('updateRules', {
            periodInMinutes: 60 * 24 // مرة كل 24 ساعة
        });
    });
};

// تخزين التغذية الراجعة في الذاكرة المؤقتة
let feedbackCache = [];
const MAX_CACHE_SIZE = 50;
const FEEDBACK_PATH = 'Feedback';

// دالة لحفظ التغذية الراجعة فوراً
const saveImmediateFeedback = async (feedback) => {
    try {
        const date = new Date();
        const fileName = `feedback_${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}_${date.getSeconds().toString().padStart(2, '0')}.json`;
        
        // تحويل البيانات إلى نص JSON منسق
        const jsonContent = JSON.stringify({
            timestamp: date.toISOString(),
            data: feedback
        }, null, 2);
        
        // حفظ في chrome.storage أولاً
        await chrome.storage.local.set({
            [`feedback_${date.getTime()}`]: jsonContent
        });

        // إنشاء Blob للتنزيل
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // تنزيل الملف
        await chrome.downloads.download({
            url: url,
            filename: `${FEEDBACK_PATH}/${fileName}`,
            conflictAction: 'uniquify',
            saveAs: false
        });

        // تنظيف
        URL.revokeObjectURL(url);
        console.log(`Feedback saved successfully to ${fileName}`);

        return { success: true, fileName };
    } catch (error) {
        console.error('Error saving immediate feedback:', error);
        // محاولة الحفظ في التخزين المحلي فقط في حالة الفشل
        try {
            await chrome.storage.local.set({
                [`feedback_error_${Date.now()}`]: {
                    error: error.message,
                    feedback
                }
            });
        } catch (storageError) {
            console.error('Failed to save to storage:', storageError);
        }
        return { error: error.message };
    }
};

// دالة لتفريغ الذاكرة المؤقتة
const flushFeedbackCache = async () => {
    if (feedbackCache.length === 0) return;

    try {
        const date = new Date();
        const fileName = `feedback_batch_${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}_${date.getHours().toString().padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}.json`;
        
        // تحويل البيانات إلى نص JSON منسق
        const jsonContent = JSON.stringify({
            timestamp: date.toISOString(),
            count: feedbackCache.length,
            data: feedbackCache
        }, null, 2);

        // حفظ في chrome.storage أولاً
        await chrome.storage.local.set({
            [`feedback_batch_${date.getTime()}`]: jsonContent
        });
        
        // إنشاء Blob للتنزيل
        const blob = new Blob([jsonContent], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        // تنزيل الملف
        await chrome.downloads.download({
            url: url,
            filename: `${FEEDBACK_PATH}/${fileName}`,
            conflictAction: 'uniquify',
            saveAs: false
        });

        // تنظيف
        URL.revokeObjectURL(url);
        console.log(`Batch feedback saved successfully to ${fileName}`);
        
        // تفريغ الذاكرة المؤقتة
        feedbackCache = [];
    } catch (error) {
        console.error('Error flushing feedback cache:', error);
        // محاولة الحفظ في التخزين المحلي فقط في حالة الفشل
        try {
            await chrome.storage.local.set({
                [`feedback_batch_error_${Date.now()}`]: {
                    error: error.message,
                    data: feedbackCache
                }
            });
        } catch (storageError) {
            console.error('Failed to save to storage:', storageError);
        }
    }
};

// دالة لاسترجاع التغذية الراجعة المخزنة
const getFeedbackData = async () => {
    try {
        const data = await chrome.storage.local.get(null);
        return Object.entries(data)
            .filter(([key]) => key.startsWith('feedback_'))
            .map(([key, value]) => ({
                key,
                ...JSON.parse(value)
            }));
    } catch (error) {
        console.error('Error getting feedback data:', error);
        return [];
    }
};

// معالجة الرسائل
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        try {
            switch (message.type) {
                case 'adBlocked':
                    const isWhitelistedPage = await isWhitelisted(sender.tab.url);
                    if (!isWhitelistedPage) {
                        await updateStats('dom');
                    }
                    sendResponse({ success: true, whitelisted: isWhitelistedPage });
                    break;

                case 'getStats':
                    const settings = await validateStoredData();
                    sendResponse({ stats: settings.stats });
                    break;

                case 'resetStats':
                    const currentSettings = await validateStoredData();
                    currentSettings.stats = {
                        totalBlocked: 0,
                        domBlocked: 0,
                        networkBlocked: 0,
                        lastReset: new Date().toISOString()
                    };
                    await chrome.storage.sync.set({ settings: currentSettings });
                    updateBadge(0);
                    sendResponse({ stats: currentSettings.stats });
                    break;

                case 'toggleEnabled':
                    if (message.enabled) {
                        await chrome.declarativeNetRequest.updateEnabledRulesets({
                            enableRulesetIds: ['default']
                        });
                    } else {
                        await chrome.declarativeNetRequest.updateEnabledRulesets({
                            disableRulesetIds: ['default']
                        });
                    }
                    sendResponse({ success: true });
                    break;

                case 'saveFeedback':
                    if (message.immediate) {
                        // حفظ فوري
                        const result = await saveImmediateFeedback(message.data);
                        sendResponse(result);
                    } else {
                        // إضافة إلى الذاكرة المؤقتة
                        feedbackCache.push({
                            ...message.data,
                            tabId: sender.tab?.id,
                            timestamp: new Date().toISOString()
                        });

                        // تفريغ الذاكرة المؤقتة إذا وصلت للحد الأقصى
                        if (feedbackCache.length >= MAX_CACHE_SIZE) {
                            await flushFeedbackCache();
                        }

                        sendResponse({ success: true });
                    }
                    break;

                case 'getFeedback':
                    const feedbackData = await getFeedbackData();
                    sendResponse({ success: true, data: feedbackData });
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ error: error.message });
        }
    })();
    return true;
});

// تتبع الطلبات المحظورة
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(async (info) => {
    try {
        const tab = await chrome.tabs.get(info.request.tabId);
        if (tab && tab.url) {
            const isWhitelistedPage = await isWhitelisted(tab.url);
            if (!isWhitelistedPage) {
                updateStats('network');
            }
        }
    } catch (error) {
        console.error('Error handling blocked request:', error);
    }
});

// معالجة التنبيهات
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'updateRules') {
        updateRules();
    } else if (alarm.name === 'flushFeedbackCache') {
        flushFeedbackCache();
    }
});

// إعداد التنبيه لحفظ التغذية الراجعة كل دقيقة
const setupFeedbackAlarm = () => {
    chrome.alarms.create('flushFeedbackCache', {
        periodInMinutes: 1,
        when: Date.now() + 60000
    });
};

// تهيئة الإضافة
chrome.runtime.onInstalled.addListener(async () => {
    try {
        await initializeSettings();
        await validateStoredData();
        await updateRules();
        setupPeriodicRulesUpdate();
        setupFeedbackAlarm();
        
        const settings = await validateStoredData();
        updateBadge(settings.stats.totalBlocked);
    } catch (error) {
        console.error('Error during extension initialization:', error);
    }
});
