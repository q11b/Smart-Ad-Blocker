// تحميل الإعدادات عند فتح النافذة المنبثقة
document.addEventListener('DOMContentLoaded', function() {
    const enableToggle = document.getElementById('enableToggle');
    const resetStatsButton = document.getElementById('resetStats');
    const openWhitelistButton = document.getElementById('openWhitelist');
    const totalBlockedElement = document.getElementById('totalBlocked');
    const domBlockedElement = document.getElementById('domBlocked');
    const networkBlockedElement = document.getElementById('networkBlocked');
    const lastResetElement = document.getElementById('lastReset');
    const whitelistInput = document.getElementById('whitelistInput');
    const addToWhitelistButton = document.getElementById('addToWhitelist');
    const whitelistItems = document.getElementById('whitelistItems');
    const exportFeedbackButton = document.getElementById('exportFeedback');

    // تحميل الإعدادات
    loadSettings();
    
    // تحديث الإحصائيات
    updateStats();
    
    // معالجة تفعيل/تعطيل الإضافة
    enableToggle.addEventListener('change', function() {
        chrome.storage.sync.get(['settings'], (result) => {
            const settings = result.settings || {};
            settings.enabled = this.checked;
            chrome.storage.sync.set({ settings }, () => {
                chrome.runtime.sendMessage({ 
                    type: 'toggleEnabled',
                    enabled: settings.enabled 
                });
            });
        });
    });
    
    // معالجة إعادة تعيين الإحصائيات
    resetStatsButton.addEventListener('click', function() {
        chrome.runtime.sendMessage({ type: 'resetStats' }, (response) => {
            if (response && response.stats) {
                updateStats(response.stats);
            }
        });
    });
    
    // فتح صفحة القائمة البيضاء
    openWhitelistButton.addEventListener('click', function() {
        chrome.tabs.create({
            url: 'whitelist.html'
        });
    });

    // إضافة موقع للقائمة البيضاء
    addToWhitelistButton.addEventListener('click', () => {
        const domain = whitelistInput.value.trim();
        if (domain) {
            chrome.storage.sync.get(['settings'], (result) => {
                const settings = result.settings || {};
                if (!settings.whitelist) {
                    settings.whitelist = [];
                }
                if (!settings.whitelist.includes(domain)) {
                    settings.whitelist.push(domain);
                    chrome.storage.sync.set({ settings });
                    renderWhitelist(settings.whitelist);
                    whitelistInput.value = '';
                }
            });
        }
    });

    // عرض القائمة البيضاء
    function renderWhitelist(whitelist) {
        whitelistItems.innerHTML = '';
        whitelist.forEach(domain => {
            const item = document.createElement('div');
            item.className = 'whitelist-item';
            
            const domainText = document.createElement('span');
            domainText.textContent = domain;
            
            const removeButton = document.createElement('button');
            removeButton.className = 'remove-btn';
            removeButton.textContent = 'حذف';
            removeButton.onclick = () => removeFromWhitelist(domain);
            
            item.appendChild(domainText);
            item.appendChild(removeButton);
            whitelistItems.appendChild(item);
        });
    }

    // حذف موقع من القائمة البيضاء
    function removeFromWhitelist(domain) {
        chrome.storage.sync.get(['settings'], (result) => {
            const settings = result.settings || {};
            settings.whitelist = settings.whitelist.filter(d => d !== domain);
            chrome.storage.sync.set({ settings });
            renderWhitelist(settings.whitelist);
        });
    }

    // تصدير بيانات التغذية الراجعة
    exportFeedbackButton.addEventListener('click', function() {
        chrome.storage.local.get(['feedbackData'], function(result) {
            if (!result.feedbackData) {
                alert('لا توجد بيانات تغذية راجعة للتصدير');
                return;
            }
            
            const feedback = result.feedbackData;
            const data = {
                falsePositives: Array.from(feedback.falsePositives || []),
                confirmedAds: Array.from(feedback.confirmedAds || []),
                timestamp: feedback.timestamp || new Date().toISOString()
            };
            
            // تحويل البيانات إلى نص JSON
            const jsonString = JSON.stringify(data, null, 2);
            
            // إنشاء ملف للتحميل
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            // إنشاء رابط التحميل
            const a = document.createElement('a');
            a.href = url;
            a.download = `adblock_feedback_${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            
            // تنظيف
            setTimeout(function() {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 0);
        });
    });

    // دالة لعرض التغذية الراجعة
    const showFeedback = async () => {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getFeedback' });
            if (response.error) {
                console.error('Error getting feedback:', response.error);
                return;
            }

            console.log('Stored feedback:', response.data);
            // يمكنك هنا إضافة كود لعرض البيانات في واجهة المستخدم
        } catch (error) {
            console.error('Error showing feedback:', error);
        }
    };

    // عرض التغذية الراجعة المخزنة
    showFeedback();

    // تحديث الإحصائيات كل 5 ثواني
    setInterval(() => {
        chrome.runtime.sendMessage({ type: 'getStats' }, (response) => {
            if (response && response.stats) {
                updateStats(response.stats);
            }
        });
    }, 5000);
});

// تحميل الإعدادات
function loadSettings() {
    chrome.storage.sync.get(['settings'], function(result) {
        const settings = result.settings || { enabled: true };
        document.getElementById('enableToggle').checked = settings.enabled;
    });
}

// تحديث الإحصائيات
function updateStats(stats) {
    const totalBlockedElement = document.getElementById('totalBlocked');
    const domBlockedElement = document.getElementById('domBlocked');
    const networkBlockedElement = document.getElementById('networkBlocked');
    const lastResetElement = document.getElementById('lastReset');
    
    if (!stats) {
        chrome.storage.sync.get(['stats'], function(result) {
            stats = result.stats || {
                totalBlocked: 0,
                domBlocked: 0,
                networkBlocked: 0,
                lastReset: '-'
            };
        });
    }
    
    totalBlockedElement.textContent = stats.totalBlocked || 0;
    domBlockedElement.textContent = stats.domBlocked || 0;
    networkBlockedElement.textContent = stats.networkBlocked || 0;
    lastResetElement.textContent = stats.lastReset || '-';
}

// الاستماع لتغييرات الإعدادات
chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
        const settings = changes.settings.newValue;
        if (settings) {
            document.getElementById('enableToggle').checked = settings.enabled;
            updateStats(settings.stats);
            renderWhitelist(settings.whitelist);
        }
    }
});
