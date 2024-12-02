// نظام التغذية المرجعية
const feedbackSystem = {
    falsePositives: new Set(),
    confirmedAds: new Set(),
    threshold: 4, // الحد الأدنى للنقاط
    maxSize: 1000, // الحد الأقصى لحجم الذاكرة
    
    // حفظ البيانات
    async save() {
        const data = {
            falsePositives: Array.from(this.falsePositives),
            confirmedAds: Array.from(this.confirmedAds),
            timestamp: Date.now()
        };
        await chrome.storage.local.set({ feedbackData: data });
    },
    
    // تحميل البيانات
    async load() {
        const result = await chrome.storage.local.get(['feedbackData']);
        if (result.feedbackData) {
            this.falsePositives = new Set(result.feedbackData.falsePositives);
            this.confirmedAds = new Set(result.feedbackData.confirmedAds);
        }
    },
    
    // إضافة عنصر كإعلان مؤكد
    addConfirmedAd(signature) {
        if (this.confirmedAds.size >= this.maxSize) {
            const oldestItem = Array.from(this.confirmedAds)[0];
            this.confirmedAds.delete(oldestItem);
        }
        this.confirmedAds.add(signature);
        this.falsePositives.delete(signature);
        this.save();
    },
    
    // إضافة عنصر كنتيجة خاطئة
    addFalsePositive(signature) {
        if (this.falsePositives.size >= this.maxSize) {
            const oldestItem = Array.from(this.falsePositives)[0];
            this.falsePositives.delete(oldestItem);
        }
        this.falsePositives.add(signature);
        this.confirmedAds.delete(signature);
        this.save();
    },
    
    // التحقق من العنصر
    isKnownFalsePositive(signature) {
        return this.falsePositives.has(signature);
    },
    
    isConfirmedAd(signature) {
        return this.confirmedAds.has(signature);
    }
};

// قائمة الكلمات المفتاحية للإعلانات
const adKeywords = [
    'ad', 'ads', 'advert', 'advertisement', 'advertising', 'banner',
    'sponsor', 'sponsored', 'promotion', 'promoted', 'recommended'
];

// قائمة الفئات المشبوهة
const suspiciousClasses = [
    'ad', 'ads', 'advert', 'advertisement', 'banner', 'sponsored',
    'promotion', 'recommended', 'partner', 'commercial'
];

// قائمة المعرفات المشبوهة
const suspiciousIds = [
    'ad', 'ads', 'advert', 'advertisement', 'banner', 'sponsored',
    'promotion', 'recommended', 'partner', 'commercial'
];

// قائمة العناصر المستثناة
const excludedElements = [
    'header', 'footer', 'nav', 'main', 'article', 'section',
    'form', 'search', 'menu', 'dialog'
];

// إنشاء توقيع للعنصر
function createElementSignature(element) {
    const rect = element.getBoundingClientRect();
    const attributes = Array.from(element.attributes)
        .map(attr => `${attr.name}="${attr.value}"`)
        .join('');
    return `${element.tagName}-${attributes}-${rect.width}x${rect.height}`;
}

// تحليل عنصر HTML للكشف عن الإعلانات
const analyzeElement = (element) => {
    const rect = element.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(element);
    
    return {
        tagName: element.tagName.toLowerCase(),
        id: element.id,
        classes: Array.from(element.classList),
        size: {
            width: rect.width,
            height: rect.height
        },
        position: {
            top: rect.top,
            left: rect.left
        },
        styles: {
            display: computedStyle.display,
            position: computedStyle.position,
            zIndex: computedStyle.zIndex,
            visibility: computedStyle.visibility
        },
        attributes: Array.from(element.attributes).map(attr => ({
            name: attr.name,
            value: attr.value
        })),
        innerHTML: element.innerHTML.length > 1000 ? 
            element.innerHTML.substring(0, 1000) + '...' : 
            element.innerHTML,
        innerText: element.innerText.length > 500 ?
            element.innerText.substring(0, 500) + '...' :
            element.innerText
    };
};

// توليد توقيع فريد للعنصر
const generateElementSignature = (element) => {
    const data = analyzeElement(element);
    return {
        signature: `${data.tagName}#${data.id || ''}${data.classes.join('.')}`,
        details: data
    };
};

// حفظ معلومات التغذية الراجعة
const saveFeedback = async (element, type, isConfirmedAd) => {
    try {
        const elementData = generateElementSignature(element);
        const feedback = {
            timestamp: new Date().toISOString(),
            url: window.location.href,
            domain: window.location.hostname,
            type: type,
            isConfirmedAd: isConfirmedAd,
            element: elementData,
            pageMetadata: {
                title: document.title,
                description: document.querySelector('meta[name="description"]')?.content || '',
                keywords: document.querySelector('meta[name="keywords"]')?.content || ''
            },
            networkRequests: Array.from(performance.getEntriesByType('resource'))
                .filter(entry => entry.initiatorType === 'script' || entry.initiatorType === 'img')
                .map(entry => ({
                    url: entry.name,
                    type: entry.initiatorType,
                    duration: entry.duration
                }))
        };

        // إرسال مباشرة إلى background script
        const response = await chrome.runtime.sendMessage({
            type: 'saveFeedback',
            data: feedback,
            immediate: true // علامة للحفظ الفوري
        });

        if (response.error) {
            throw new Error(response.error);
        }

        console.log('Feedback sent successfully:', response);

        // حفظ نسخة احتياطية في التخزين المحلي
        const storedFeedback = JSON.parse(localStorage.getItem('adBlockerFeedback') || '[]');
        storedFeedback.push(feedback);
        if (storedFeedback.length > 100) { // الاحتفاظ بآخر 100 عنصر فقط
            storedFeedback.splice(0, storedFeedback.length - 100);
        }
        localStorage.setItem('adBlockerFeedback', JSON.stringify(storedFeedback));

    } catch (error) {
        console.error('Error saving feedback:', error);
        // حفظ في التخزين المحلي في حالة الفشل
        const errorFeedback = JSON.parse(localStorage.getItem('adBlockerFeedbackErrors') || '[]');
        errorFeedback.push({
            timestamp: new Date().toISOString(),
            error: error.message,
            data: feedback
        });
        localStorage.setItem('adBlockerFeedbackErrors', JSON.stringify(errorFeedback));
    }
};

// تحديث قائمة العناصر المحظورة
const updateBlockedElements = (element, isBlocked) => {
    const signature = generateElementSignature(element).signature;
    const blockedElements = JSON.parse(localStorage.getItem('blockedElements') || '{}');
    
    if (isBlocked) {
        blockedElements[signature] = (blockedElements[signature] || 0) + 1;
    } else {
        delete blockedElements[signature];
    }
    
    localStorage.setItem('blockedElements', JSON.stringify(blockedElements));
};

// فحص العنصر للكشف عن الإعلانات
const checkElement = async (element) => {
    try {
        if (isExcludedElement(element)) return;
        
        const score = calculateAdScore(element);
        const signature = generateElementSignature(element).signature;
        
        if (score >= 4) {
            // حفظ التغذية الراجعة عند اكتشاف إعلان
            await saveFeedback(element, 'detected', true);
            
            // إخفاء العنصر
            await hideElement(element);
            
            // تحديث القائمة
            updateBlockedElements(element, true);
            
            // إضافة إلى قائمة الإعلانات المؤكدة
            feedbackSystem.addConfirmedAd(signature);
        }
    } catch (error) {
        console.error('Error checking element:', error);
    }
};

// دالة لحساب درجة احتمالية كون العنصر إعلاناً
const calculateAdScore = (element) => {
    let score = 0;
    const data = analyzeElement(element);
    
    // فحص الكلمات المفتاحية
    const adKeywords = ['ad', 'ads', 'advertisement', 'sponsored', 'promotion'];
    const text = (data.innerText + data.innerHTML).toLowerCase();
    adKeywords.forEach(keyword => {
        if (text.includes(keyword)) score += 0.2;
    });
    
    // فحص الأحجام النموذجية للإعلانات
    const commonAdSizes = [
        [728, 90],  // Leaderboard
        [300, 250], // Medium Rectangle
        [160, 600], // Wide Skyscraper
        [320, 50]   // Mobile Banner
    ];
    
    commonAdSizes.forEach(([width, height]) => {
        if (Math.abs(data.size.width - width) < 10 && Math.abs(data.size.height - height) < 10) {
            score += 0.3;
        }
    });
    
    // فحص الروابط والصور
    const links = element.getElementsByTagName('a');
    const images = element.getElementsByTagName('img');
    if (links.length > 0 && images.length > 0) score += 0.2;
    
    // فحص السمات المشبوهة
    const suspiciousAttributes = ['data-ad', 'data-ad-client', 'data-ad-slot'];
    data.attributes.forEach(attr => {
        if (suspiciousAttributes.some(sus => attr.name.includes(sus))) {
            score += 0.3;
        }
    });
    
    return Math.min(score, 1);
};

// دالة للتحقق من النص
function containsAdKeyword(text) {
    if (!text) return false;
    text = text.toLowerCase();
    return adKeywords.some(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'i');
        return regex.test(text);
    });
}

// دالة للتحقق من الفئات
function hasSuspiciousClass(element) {
    if (!element.className) return false;
    const classes = element.className.toLowerCase().split(' ');
    return suspiciousClasses.some(cls => 
        classes.some(c => c.includes(cls))
    );
}

// دالة للتحقق من المعرفات
function hasSuspiciousId(element) {
    if (!element.id) return false;
    const id = element.id.toLowerCase();
    return suspiciousIds.some(sid => id.includes(sid));
}

// دالة للتحقق من الروابط
function isAdLink(element) {
    const href = element.href?.toLowerCase();
    if (!href) return false;
    return href.includes('ad') || 
           href.includes('sponsor') || 
           href.includes('promotion') ||
           href.includes('click') ||
           href.includes('track');
}

// التحقق من العناصر المستثناة
function isExcludedElement(element) {
    return excludedElements.includes(element.tagName.toLowerCase()) ||
           element.closest(excludedElements.join(','));
}

// دالة لحساب نقاط الإعلان
function calculateAdScoreOld(element) {
    // التحقق من العناصر المستثناة أولاً
    if (isExcludedElement(element)) return 0;
    
    const signature = createElementSignature(element);
    
    // التحقق من التغذية المرجعية
    if (feedbackSystem.isKnownFalsePositive(signature)) return 0;
    if (feedbackSystem.isConfirmedAd(signature)) return 10;
    
    let score = 0;

    // فحص النص
    if (containsAdKeyword(element.textContent)) score += 2;
    
    // فحص الفئات
    if (hasSuspiciousClass(element)) score += 2;
    
    // فحص المعرفات
    if (hasSuspiciousId(element)) score += 2;
    
    // فحص الروابط
    if (isAdLink(element)) score += 3;
    
    // فحص الأبعاد
    const rect = element.getBoundingClientRect();
    if (rect.width > 300 && rect.height > 250) score += 1;
    
    // فحص الموقع
    const viewportHeight = window.innerHeight;
    if (rect.top < viewportHeight * 0.3) score += 1;
    
    // فحص iframes
    if (element.tagName === 'IFRAME') score += 2;
    
    // تخفيض النقاط للعناصر الكبيرة جداً
    if (rect.width > window.innerWidth * 0.8 || 
        rect.height > window.innerHeight * 0.8) {
        score -= 5;
    }
    
    return score;
}

// دالة لإخفاء العنصر بشكل تدريجي
const hideElement = async (element) => {
    try {
        // حفظ الموقع والأبعاد الأصلية
        const rect = element.getBoundingClientRect();
        const originalStyles = {
            width: rect.width + 'px',
            height: rect.height + 'px',
            margin: window.getComputedStyle(element).margin,
            padding: window.getComputedStyle(element).padding
        };

        // إنشاء عنصر بديل
        const placeholder = document.createElement('div');
        placeholder.className = 'ad-placeholder';
        placeholder.style.cssText = `
            width: ${originalStyles.width};
            height: ${originalStyles.height};
            margin: ${originalStyles.margin};
            padding: ${originalStyles.padding};
            background: #f0f0f0;
            border: 1px dashed #ccc;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            transition: all 0.3s ease;
        `;

        // إضافة زر التراجع
        const undoButton = document.createElement('button');
        undoButton.textContent = 'ليس إعلاناً';
        undoButton.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 5px 10px;
            background: #fff;
            border: 1px solid #ccc;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        `;

        // إضافة مستمع حدث للزر
        undoButton.addEventListener('click', async () => {
            // استعادة العنصر الأصلي
            element.style.display = '';
            placeholder.remove();
            
            // حفظ التغذية الراجعة
            await saveFeedback(element, 'false_positive', false);
            
            // تحديث القائمة
            updateBlockedElements(element, false);
            
            // إضافة إلى قائمة النتائج الخاطئة
            feedbackSystem.addFalsePositive(generateElementSignature(element).signature);
        });

        placeholder.appendChild(undoButton);
        
        // إخفاء العنصر الأصلي وإضافة العنصر البديل
        element.style.display = 'none';
        element.parentNode.insertBefore(placeholder, element);

        // حفظ التغذية الراجعة للإعلان المكتشف
        await saveFeedback(element, 'blocked', true);
    } catch (error) {
        console.error('Error hiding element:', error);
    }
};

// دالة لفحص العنصر وأبنائه
function scanElement(element, processedElements = new Set()) {
    if (processedElements.has(element)) return;
    processedElements.add(element);

    const score = calculateAdScoreOld(element);
    if (score >= feedbackSystem.threshold) {
        hideElement(element);
        return;
    }

    // فحص العناصر الفرعية
    Array.from(element.children).forEach(child => {
        scanElement(child, processedElements);
    });
}

// دالة لفحص العناصر الجديدة
function observeNewElements() {
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    scanElement(node);
                }
            });
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// بدء الفحص
async function startAdBlocking() {
    // تحميل بيانات التغذية المرجعية
    await feedbackSystem.load();
    
    // فحص الصفحة الحالية
    scanElement(document.body);
    
    // مراقبة التغييرات
    observeNewElements();
}

// مراقبة التغييرات في DOM
const observeDOM = () => {
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) { // عنصر HTML
                    checkElement(node);
                }
            });
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
};

// بدء المراقبة عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    // فحص العناصر الموجودة
    document.querySelectorAll('*').forEach(element => {
        checkElement(element);
    });
    
    // بدء مراقبة التغييرات
    observeDOM();
});

// التحقق من حالة التفعيل قبل البدء
chrome.storage.sync.get(['settings'], (result) => {
    const settings = result.settings || { enabled: true };
    if (settings.enabled) {
        // تأخير البدء للتأكد من تحميل الصفحة
        setTimeout(startAdBlocking, 1000);
    }
});
