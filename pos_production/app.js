// ════════════════════════════════════════════════
// app.js — Core Application Logic
// أيمن الشرنوبى — نظام البيع الذهبي v5.0
// ════════════════════════════════════════════════
//
// Architecture:
//   app.js      — Core logic, globals, init, UI
//   storage.js  — IndexedDB, backup, restore
//   invoice.js  — Invoices, print, WhatsApp
//   settings.js — Settings, barcode, theme
//   sw.js       — Service worker, offline, cache
//
// ════════════════════════════════════════════════


// ════════════════════════════════════════════
// FIREBASE CONFIG + LIGHT SYNC LAYER
// IndexedDB = المصدر الأساسي (سريع + offline)
// Firebase = backup + sync في الخلفية فقط
// ════════════════════════════════════════════
const FB_CONFIG = {
  apiKey: "AIzaSyAUtaEzidxkTH6JlMe40PHKom_2DLgyZUs",
  authDomain: "toktok-web-284d5.firebaseapp.com",
  projectId: "toktok-web-284d5",
  storageBucket: "toktok-web-284d5.firebasestorage.app",
  messagingSenderId: "450533440515",
  appId: "1:450533440515:web:9e73e8c794226cb2c72236"
};

let fbApp=null, fbDB=null, fbEnabled=false, fbSyncing=false;
let fbUnsub = {}; // للـ real-time listeners

// تهيئة Firebase (في الخلفية - لا تؤثر على بدء التطبيق)
function initFirebase(){
  try{
    fbApp = firebase.initializeApp(FB_CONFIG);
    fbDB  = firebase.firestore();
    fbDB.settings({cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED});
    fbDB.enablePersistence({synchronizeTabs:true}).catch(()=>{});
    fbEnabled = true;
    console.log('✅ Firebase جاهز');
    updateFBStatus(true);
    // مزامنة تلقائية real-time
    startRealtimeSync();
  }catch(e){
    console.warn('⚠️ Firebase غير متاح — التطبيق يعمل بشكل طبيعي:', e.message);
    fbEnabled = false;
    updateFBStatus(false);
  }
}

function updateFBStatus(ok){
  const el = document.getElementById('fbStatus');
  if(el){
    el.textContent = ok ? '☁️ متزامن' : '💾 محلي';
    el.style.color  = ok ? 'var(--green)' : 'var(--muted)';
    el.title = ok ? 'Firebase متصل — بيانات متزامنة' : 'وضع محلي — Firebase غير متاح';
  }
}

// ════════════════════
// SYNC HELPERS
// ════════════════════
const FB_STORES = {
  products:  'products',
  customers: 'customers',
  invoices:  'invoices',
};

// رفع سجل واحد لـ Firebase (في الخلفية)
async function fbSync(store, record){
  if(!fbEnabled || !fbDB) return;
  try{
    const col = fbDB.collection(`shops/main/${store}`);
    await col.doc(String(record.id)).set(record, {merge:true});
  }catch(e){ console.warn(`fbSync ${store}:`, e.message); }
}

// رفع مجموعة كاملة
async function fbSyncAll(store, records){
  if(!fbEnabled || !fbDB || !records.length) return;
  try{
    const col = fbDB.collection(`shops/main/${store}`);
    const batchSize = 400;
    for(let i=0; i<records.length; i+=batchSize){
      const batch = fbDB.batch();
      records.slice(i,i+batchSize).forEach(r=>{
        batch.set(col.doc(String(r.id)), r, {merge:true});
      });
      await batch.commit();
    }
    console.log(`✅ fbSyncAll ${store}: ${records.length} سجل`);
  }catch(e){ console.warn(`fbSyncAll ${store}:`, e.message); }
}

// سحب كل البيانات من Firebase → IndexedDB (مرة واحدة عند أول تشغيل)
async function fbPullAll(){
  if(!fbEnabled || !fbDB) return;
  const migKey = 'fb_pulled_v1';
  if(localStorage.getItem(migKey)) return; // تم السحب من قبل
  try{
    fbSyncing = true;
    updateFBStatus(true);
    let pulled = 0;
    for(const [local, remote] of Object.entries(FB_STORES)){
      const snap = await fbDB.collection(`shops/main/${remote}`).get();
      if(snap.empty) continue;
      for(const doc of snap.docs){
        const data = doc.data();
        if(data && data.id){
          // فقط اضف لو مش موجود محلياً
          const existing = await dbAll(local);
          if(!existing.find(r=>r.id===data.id)){
            delete data.id; // اتركه لـ autoIncrement
            await dbAdd(local, data);
            pulled++;
          }
        }
      }
    }
    if(pulled > 0){
      await loadAll();
      showSection('home');
  loadGPSections();
  updateQuickStrip();
  loadShopName();
  setTimeout(initSearchBindings, 500);
  setTimeout(loadFromFirebase, 2000);
      toast(`☁️ تم سحب ${pulled} سجل من Firebase`);
    }
    localStorage.setItem(migKey,'1');
    fbSyncing = false;
  }catch(e){
    fbSyncing = false;
    console.warn('fbPullAll:', e.message);
  }
}

// ════════════════════
// REAL-TIME SYNC
// (يستمع لتغييرات الأجهزة الأخرى)
// ════════════════════
function startRealtimeSync(){
  if(!fbEnabled || !fbDB) return;

  ['products','customers','invoices'].forEach(store=>{
    if(fbUnsub[store]) fbUnsub[store](); // إلغاء listener قديم
    fbUnsub[store] = fbDB
      .collection(`shops/main/${store}`)
      .orderBy('id','desc').limit(50)
      .onSnapshot(snap=>{
        if(fbSyncing) return;
        snap.docChanges().forEach(change=>{
          if(change.type==='added' || change.type==='modified'){
            const data = change.doc.data();
            // تحديث IndexedDB في الخلفية بدون تأثير على UI
            if(data && data.id){
              dbPut(store, data).then(()=>{
                // تحديث خفيف للـ UI لو في نفس الصفحة
                loadAll().then(()=>{
                  if(store==='products') updateCounts();
                  if(store==='invoices') renderDailyReport();
                  if(store==='customers'){
                    const sb=document.getElementById('sb-debt');
                    if(sb) sb.textContent=customers.filter(c=>c.debt>0).length;
                  }
                  updateFBStatus(true);
                });
              }).catch(()=>{});
            }
          }
        }, {includeMetadataChanges:false});
      }, err=>{ console.warn('RT sync err:', err.message); updateFBStatus(false); });
  });
}

function stopRealtimeSync(){
  Object.values(fbUnsub).forEach(u=>{ try{u();}catch(e){} });
  fbUnsub = {};
}

// ════════════════════
// PUSH LOCAL → FIREBASE
// (يُستدعى بعد كل عملية محلية)
// ════════════════════
function fbPush(store, record){
  if(!fbEnabled) return;
  // في الخلفية — لا await
  fbSync(store, record).catch(()=>{});
}

// Backup كامل لـ Firebase (يدوي)
async function fbBackupAll(){
  if(!fbEnabled){toast('Firebase غير متاح حالياً','err');return;}
  toast('⏳ جاري رفع البيانات...');
  try{
    await Promise.all([
      fbSyncAll('products', products),
      fbSyncAll('customers', customers),
      fbSyncAll('invoices', invoices),
    ]);
    toast('✅ تم رفع كل البيانات لـ Firebase');
  }catch(e){ toast('❌ خطأ: '+e.message,'err'); }
}


// ════ INV_DATA 385 ITEMS ════
const INV_DATA = [{"name": "40 ايماكس", "shelf": "تحت البنك", "buyPrice": 1325, "sellPrice": 1590, "qty": 5, "category": "battery"}, {"name": "40 منشى", "shelf": "تحت", "buyPrice": 1100, "sellPrice": 1320, "qty": 4, "category": "battery"}, {"name": "70 اكسون", "shelf": "تحت", "buyPrice": 1500, "sellPrice": 1800, "qty": 1, "category": "battery"}, {"name": "70 ايماكس", "shelf": "تحت البنك", "buyPrice": 1875, "sellPrice": 2250, "qty": 2, "category": "battery"}, {"name": "80 فولتيجو", "shelf": "تحت", "buyPrice": 1900, "sellPrice": 2280, "qty": 1, "category": "battery"}, {"name": "90 ايماكس", "shelf": "تحت", "buyPrice": 2210, "sellPrice": 2652, "qty": 1, "category": "battery"}, {"name": "90 فولتا ماستر", "shelf": "تحت البنك", "buyPrice": 1600, "sellPrice": 1920, "qty": 1, "category": "battery"}, {"name": "استك برميل مارش صغير", "shelf": "9 شمال", "buyPrice": 5, "sellPrice": 6, "qty": 20, "category": "toktok"}, {"name": "استك برميل مارش كبير", "shelf": "9 شمال", "buyPrice": 10, "sellPrice": 12, "qty": 50, "category": "toktok"}, {"name": "اصلاح ماستر بالبستم", "shelf": "13 شمال", "buyPrice": 135, "sellPrice": 162, "qty": 4, "category": "toktok"}, {"name": "اكتو فاير 2011 اصلى", "shelf": "يمين 21", "buyPrice": 780, "sellPrice": 936, "qty": 1, "category": "toktok"}, {"name": "اكتوفاير 2022 اصلى", "shelf": "يمين 21", "buyPrice": 870, "sellPrice": 1044, "qty": 1, "category": "toktok"}, {"name": "اكتوفاير فروك اصلي 2016", "shelf": "يمين 21", "buyPrice": 540, "sellPrice": 648, "qty": 2, "category": "toktok"}, {"name": "اكتوفاير فروك درجه 2011", "shelf": "يمين 21", "buyPrice": 240, "sellPrice": 288, "qty": 4, "category": "toktok"}, {"name": "اكس امامي", "shelf": "يمين 7", "buyPrice": 105, "sellPrice": 126, "qty": 3, "category": "toktok"}, {"name": "اكس خلفي", "shelf": "يمين 8", "buyPrice": 165, "sellPrice": 198, "qty": 4, "category": "toktok"}, {"name": "اولسية عداد سرعه", "shelf": "10 شمال", "buyPrice": 85, "sellPrice": 102, "qty": 10, "category": "toktok"}, {"name": "اولسيه فرد امام اكس", "shelf": "10 شمال", "buyPrice": 10, "sellPrice": 12, "qty": 20, "category": "toktok"}, {"name": "اولسيه فردي صاج خلفي", "shelf": "10 شمال", "buyPrice": 10, "sellPrice": 12, "qty": 20, "category": "toktok"}, {"name": "اولسيه كرونه 2011 درجه", "shelf": "شمال 12", "buyPrice": 13, "sellPrice": 15.6, "qty": 14, "category": "toktok"}, {"name": "اولسيه كرونه اصلى 2014", "shelf": "غير محدد", "buyPrice": 29, "sellPrice": 41, "qty": 6, "category": "toktok"}, {"name": "اوليسه حلزونيه 2011", "shelf": "12 شمال", "buyPrice": 15, "sellPrice": 18, "qty": 10, "category": "toktok"}, {"name": "اوليسه عجله خلفى", "shelf": "9 شمال", "buyPrice": 10, "sellPrice": 12, "qty": 20, "category": "toktok"}, {"name": "اوليسه كرنك 2011", "shelf": "12 شمال", "buyPrice": 15, "sellPrice": 18, "qty": 9, "category": "toktok"}, {"name": "اوليسه كرنك معدل", "shelf": "10 شمال", "buyPrice": 30, "sellPrice": 36, "qty": 10, "category": "toktok"}, {"name": "اوليسه كرونه 2011", "shelf": "9 شمال", "buyPrice": 10, "sellPrice": 12, "qty": 7, "category": "toktok"}, {"name": "برميل مارش فروك صينى", "shelf": "غير محدد", "buyPrice": 110, "sellPrice": 155, "qty": 2, "category": "toktok"}, {"name": "برميل مرش اصلى", "shelf": "يمين 12", "buyPrice": 195, "sellPrice": 234, "qty": 2, "category": "toktok"}, {"name": "بست استندر 2011 توبة", "shelf": "20 شمال", "buyPrice": 505, "sellPrice": 606, "qty": 3, "category": "toktok"}, {"name": "بستم 010 توب 2018", "shelf": "20 شمال", "buyPrice": 540, "sellPrice": 648, "qty": 3, "category": "toktok"}, {"name": "بستم 010 مهلى 2011", "shelf": "19 شمال", "buyPrice": 630, "sellPrice": 756, "qty": 3, "category": "toktok"}, {"name": "بستم 010 مهلى 2018", "shelf": "19 شمال", "buyPrice": 630, "sellPrice": 756, "qty": 3, "category": "toktok"}, {"name": "بستم 010 مهلى 2018 صغير", "shelf": "19 شمال", "buyPrice": 255, "sellPrice": 306, "qty": 5, "category": "toktok"}, {"name": "بستم 010 مهلي 2011 صاج", "shelf": "غير محدد", "buyPrice": 485, "sellPrice": 679, "qty": 1, "category": "toktok"}, {"name": "بستم 020 توب 2007", "shelf": "20 شمال", "buyPrice": 510, "sellPrice": 612, "qty": 7, "category": "toktok"}, {"name": "بستم 020 توب 2011", "shelf": "20 شمال", "buyPrice": 510, "sellPrice": 612, "qty": 3, "category": "toktok"}, {"name": "بستم 020 توب 2018", "shelf": "20 شمال", "buyPrice": 540, "sellPrice": 648, "qty": 3, "category": "toktok"}, {"name": "بستم 020 تي بي 2011", "shelf": "غير محدد", "buyPrice": 425, "sellPrice": 595, "qty": 1, "category": "toktok"}, {"name": "بستم 020 مهلى 2011", "shelf": "19 شمال", "buyPrice": 670, "sellPrice": 804, "qty": 3, "category": "toktok"}, {"name": "بستم 020 مهلى 2018", "shelf": "19 شمال", "buyPrice": 630, "sellPrice": 756, "qty": 3, "category": "toktok"}, {"name": "بستم 2007 توب 010", "shelf": "20 شمال", "buyPrice": 450, "sellPrice": 540, "qty": 4, "category": "toktok"}, {"name": "بستم استندر 2007 تى بى", "shelf": "20 شمال", "buyPrice": 470, "sellPrice": 564, "qty": 3, "category": "toktok"}, {"name": "بستم استندر 2018 توب", "shelf": "20 شمال", "buyPrice": 540, "sellPrice": 648, "qty": 3, "category": "toktok"}, {"name": "بستم فرامل خلفي", "shelf": "13 شمال", "buyPrice": 170, "sellPrice": 204, "qty": 7, "category": "toktok"}, {"name": "بقره شكارتون وش وضهر", "shelf": "يمين 5", "buyPrice": 13, "sellPrice": 15.6, "qty": 1, "category": "toktok"}, {"name": "بلاطه شحن اصلى", "shelf": "يمين 11", "buyPrice": 350, "sellPrice": 420, "qty": 1, "category": "toktok"}, {"name": "بلاطه شحن صينى", "shelf": "يمين 11", "buyPrice": 190, "sellPrice": 228, "qty": 8, "category": "toktok"}, {"name": "بلي 6004 اصلي", "shelf": "28 شمال", "buyPrice": 10, "sellPrice": 12, "qty": 10, "category": "toktok"}, {"name": "بلي 6204 اصلي", "shelf": "28 شمال", "buyPrice": 95, "sellPrice": 114, "qty": 7, "category": "toktok"}, {"name": "بليا 6004 اصلي", "shelf": "28 شمال", "buyPrice": 75, "sellPrice": 90, "qty": 10, "category": "toktok"}, {"name": "بليه 16 16 اصلي", "shelf": "28 شمال", "buyPrice": 45, "sellPrice": 54, "qty": 8, "category": "toktok"}, {"name": "بليه 1607 اصلى", "shelf": "28 شمال", "buyPrice": 150, "sellPrice": 180, "qty": 5, "category": "toktok"}, {"name": "بليه 188 شعره", "shelf": "29 شمال", "buyPrice": 50, "sellPrice": 60, "qty": 9, "category": "toktok"}, {"name": "بليه 6004", "shelf": "29 شمال", "buyPrice": 75, "sellPrice": 90, "qty": 2, "category": "toktok"}, {"name": "بليه 6005 تقليد", "shelf": "28 شمال", "buyPrice": 45, "sellPrice": 54, "qty": 18, "category": "toktok"}, {"name": "بليه 6204 صينى", "shelf": "28 شمال", "buyPrice": 35, "sellPrice": 42, "qty": 8, "category": "toktok"}, {"name": "بليه 6301 اصلي", "shelf": "28 شمال", "buyPrice": 70, "sellPrice": 84, "qty": 4, "category": "toktok"}, {"name": "بليه 6301 صيني", "shelf": "28 شمال", "buyPrice": 52, "sellPrice": 63, "qty": 5, "category": "toktok"}, {"name": "بليه 6302 اصلي", "shelf": "28 شمال", "buyPrice": 85, "sellPrice": 102, "qty": 9, "category": "toktok"}, {"name": "بليه 6305 اصلى", "shelf": "28 شمال", "buyPrice": 150, "sellPrice": 180, "qty": 7, "category": "toktok"}, {"name": "بليه شعر اصلي", "shelf": "28 شمال", "buyPrice": 60, "sellPrice": 72, "qty": 6, "category": "toktok"}, {"name": "بليه فرش كبيره", "shelf": "29 شمال", "buyPrice": 30, "sellPrice": 36, "qty": 8, "category": "toktok"}, {"name": "بليه فرش كبيره بلستك", "shelf": "29 شمال", "buyPrice": 30, "sellPrice": 36, "qty": 10, "category": "toktok"}, {"name": "بليه فورش صغيره علوى", "shelf": "29 شمال", "buyPrice": 15, "sellPrice": 18, "qty": 5, "category": "toktok"}, {"name": "بليه كرنك 2014", "shelf": "28 شمال", "buyPrice": 200, "sellPrice": 240, "qty": 5, "category": "toktok"}, {"name": "بنز ركبه مقاس 19", "shelf": "12 شمال", "buyPrice": 65, "sellPrice": 78, "qty": 2, "category": "toktok"}, {"name": "بنز ركبه مقاس 25", "shelf": "12 شمال", "buyPrice": 60, "sellPrice": 72, "qty": 10, "category": "toktok"}, {"name": "بنز ركبه مقاس 60", "shelf": "12 شمال", "buyPrice": 60, "sellPrice": 72, "qty": 10, "category": "toktok"}, {"name": "بنز ستوليك اصلى", "shelf": "شمال 11", "buyPrice": 55, "sellPrice": 66, "qty": 18, "category": "toktok"}, {"name": "بوجيه 2007 هندى بجاج", "shelf": "يمين 19", "buyPrice": 60, "sellPrice": 72, "qty": 15, "category": "toktok"}, {"name": "بوجيه 2011 درجه", "shelf": "يمين 19", "buyPrice": 25, "sellPrice": 30, "qty": 10, "category": "toktok"}, {"name": "بوجيه 2014 درجه", "shelf": "يمين 19", "buyPrice": 25, "sellPrice": 30, "qty": 8, "category": "toktok"}, {"name": "بوجيه 2018 اصلى", "shelf": "يمين 19", "buyPrice": 60, "sellPrice": 72, "qty": 9, "category": "toktok"}, {"name": "بيبه بوجيه 2014 صغيره", "shelf": "يمين 18", "buyPrice": 70, "sellPrice": 84, "qty": 20, "category": "toktok"}, {"name": "بيبه بوجيه كبيره", "shelf": "يمين 25", "buyPrice": 70, "sellPrice": 84, "qty": 20, "category": "toktok"}, {"name": "بيستم استندر 2018", "shelf": "19 شمال", "buyPrice": 655, "sellPrice": 786, "qty": 6, "category": "toktok"}, {"name": "بيليا 6007 عريضه اصلي", "shelf": "28 شمال", "buyPrice": 170, "sellPrice": 204, "qty": 4, "category": "toktok"}, {"name": "تايجر", "shelf": "يمين 5", "buyPrice": 20, "sellPrice": 24, "qty": 5, "category": "toktok"}, {"name": "ترجمه تروس كورونا 2014", "shelf": "12 شمال", "buyPrice": 820, "sellPrice": 984, "qty": 1, "category": "toktok"}, {"name": "ترس 6 خرم 2014 اصلى", "shelf": "21 شمال", "buyPrice": 625, "sellPrice": 750, "qty": 2, "category": "toktok"}, {"name": "ترس 80 سنه", "shelf": "يمين 5", "buyPrice": 155, "sellPrice": 186, "qty": 2, "category": "toktok"}, {"name": "ترس بالمغناطيس 2014", "shelf": "شمال 13", "buyPrice": 500, "sellPrice": 600, "qty": 2, "category": "toktok"}, {"name": "ترس بالمغناطيس 2016", "shelf": "13 شمال", "buyPrice": 500, "sellPrice": 600, "qty": 2, "category": "toktok"}, {"name": "ترس بالمغناطيس 2018", "shelf": "شمال 13", "buyPrice": 500, "sellPrice": 600, "qty": 1, "category": "toktok"}, {"name": "ترس بل المغناطيس 2011", "shelf": "13 شمال", "buyPrice": 550, "sellPrice": 660, "qty": 1, "category": "toktok"}, {"name": "ترس كرنك صغير 2014", "shelf": "شمال 11", "buyPrice": 75, "sellPrice": 90, "qty": 5, "category": "toktok"}, {"name": "ترس مايل 2011", "shelf": "13 شمال", "buyPrice": 195, "sellPrice": 234, "qty": 1, "category": "toktok"}, {"name": "ترس مايل 2016", "shelf": "13 شمال", "buyPrice": 195, "sellPrice": 234, "qty": 2, "category": "toktok"}, {"name": "ترس هرم 2011 3 دور", "shelf": "21 شمال", "buyPrice": 300, "sellPrice": 360, "qty": 4, "category": "toktok"}, {"name": "ترس هرم 2014 بجاج اصلى", "shelf": "شمال 21", "buyPrice": 260, "sellPrice": 364, "qty": 1, "category": "toktok"}, {"name": "تيل فرامل اندرياس", "shelf": "يمين 45", "buyPrice": 125, "sellPrice": 150, "qty": 6, "category": "toktok"}, {"name": "تيله شق", "shelf": "9 شمال", "buyPrice": 5, "sellPrice": 6, "qty": 15, "category": "toktok"}, {"name": "جراب بنزين 2011", "shelf": "غير محدد", "buyPrice": 115, "sellPrice": 161, "qty": 1, "category": "toktok"}, {"name": "جراب دبرياج 2007 تقليد", "shelf": "يمين تحت البنك 1", "buyPrice": 70, "sellPrice": 84, "qty": 3, "category": "toktok"}, {"name": "جراب سرعه 2014 اصلى", "shelf": "غير محدد", "buyPrice": 170, "sellPrice": 238, "qty": 2, "category": "toktok"}, {"name": "جراب غيارات", "shelf": "غير محدد", "buyPrice": 155, "sellPrice": 217, "qty": 1, "category": "toktok"}, {"name": "جلبه بوجيه 2014 اصلي", "shelf": "يمين 25", "buyPrice": 50, "sellPrice": 60, "qty": 4, "category": "toktok"}, {"name": "جلبه مساعد امامي", "shelf": "10 شمال", "buyPrice": 30, "sellPrice": 36, "qty": 5, "category": "toktok"}, {"name": "جلد خزنه امامي اندرياس", "shelf": "شمال 9", "buyPrice": 35, "sellPrice": 42, "qty": 5, "category": "toktok"}, {"name": "جلد صباب", "shelf": "10 شمال", "buyPrice": 45, "sellPrice": 54, "qty": 9, "category": "toktok"}, {"name": "جلد ماستر عمومي", "shelf": "9 شمال", "buyPrice": 55, "sellPrice": 66, "qty": 100, "category": "toktok"}, {"name": "جمجومه", "shelf": "خلفى 9", "buyPrice": 20.5, "sellPrice": 25, "qty": 3, "category": "toktok"}, {"name": "جنط بيق بون", "shelf": "خلفى 3", "buyPrice": 240, "sellPrice": 288, "qty": 1, "category": "toktok"}, {"name": "جنط دهب هندى", "shelf": "يمين 32", "buyPrice": 240, "sellPrice": 288, "qty": 2, "category": "toktok"}, {"name": "جنط سابا هندى", "shelf": "خلفى 12", "buyPrice": 255, "sellPrice": 306, "qty": 4, "category": "toktok"}, {"name": "جنط لاكش", "shelf": "يمين 39", "buyPrice": 280, "sellPrice": 336, "qty": 5, "category": "toktok"}, {"name": "جوان سكرتوره", "shelf": "شمال 6", "buyPrice": 4, "sellPrice": 5, "qty": 100, "category": "toktok"}, {"name": "جوان شداد", "shelf": "شمال 6", "buyPrice": 4, "sellPrice": 5, "qty": 100, "category": "toktok"}, {"name": "جوان شكمان حرارى", "shelf": "شمال 6", "buyPrice": 5, "sellPrice": 6, "qty": 100, "category": "toktok"}, {"name": "جوان شكمان عمولة", "shelf": "يمين 1", "buyPrice": 8, "sellPrice": 9.6, "qty": 50, "category": "toktok"}, {"name": "جوان فلتر زيت", "shelf": "شمال 6", "buyPrice": 4, "sellPrice": 5, "qty": 100, "category": "toktok"}, {"name": "جوان قاعدة سرعة", "shelf": "يمين 1", "buyPrice": 7, "sellPrice": 8.4, "qty": 100, "category": "toktok"}, {"name": "جوان كربرتير", "shelf": "يمين 25", "buyPrice": 10, "sellPrice": 12, "qty": 19, "category": "toktok"}, {"name": "جوان كرونه 2014 عموله", "shelf": "غير محدد", "buyPrice": 30, "sellPrice": 36, "qty": 9, "category": "toktok"}, {"name": "جوان كورونا 2014", "shelf": "7 شمال", "buyPrice": 30, "sellPrice": 36, "qty": 8, "category": "toktok"}, {"name": "جوان كورونه 2011 عمولة", "shelf": "7 شمال", "buyPrice": 30, "sellPrice": 36, "qty": 4, "category": "toktok"}, {"name": "جوان وش زيت 2011 درجة", "shelf": "7 شمال", "buyPrice": 20, "sellPrice": 24, "qty": 14, "category": "toktok"}, {"name": "جوان وش زيت 2014 عمولة", "shelf": "غير محدد", "buyPrice": 30, "sellPrice": 36, "qty": 3, "category": "toktok"}, {"name": "جوان وش سلندر 2014 اصلى", "shelf": "شمال 2", "buyPrice": 75, "sellPrice": 90, "qty": 4, "category": "toktok"}, {"name": "جون وش زيت اصلي 2011", "shelf": "7 شمال", "buyPrice": 60, "sellPrice": 72, "qty": 10, "category": "toktok"}, {"name": "جويد وش سلندر", "shelf": "21 شمال", "buyPrice": 60, "sellPrice": 72, "qty": 19, "category": "toktok"}, {"name": "جويط شكمان", "shelf": "يمين 11", "buyPrice": 15, "sellPrice": 18, "qty": 22, "category": "toktok"}, {"name": "حامل كتينه اصلى", "shelf": "شمال 11", "buyPrice": 8, "sellPrice": 9.6, "qty": 23, "category": "toktok"}, {"name": "حشو فلتر 2007 فروك درجه", "shelf": "غير محدد", "buyPrice": 45, "sellPrice": 63, "qty": 6, "category": "toktok"}, {"name": "حشوه فلتر زيت", "shelf": "يمين 33", "buyPrice": 25, "sellPrice": 30, "qty": 21, "category": "toktok"}, {"name": "حشوه فلتر زيت مدور", "shelf": "خلفى 14", "buyPrice": 90, "sellPrice": 108, "qty": 5, "category": "toktok"}, {"name": "حلبه مقص خلفى اصلى", "shelf": "9 شمال", "buyPrice": 30, "sellPrice": 36, "qty": 6, "category": "toktok"}, {"name": "حلزون الدبرياج كامله 2011", "shelf": "13 شمال", "buyPrice": 75, "sellPrice": 90, "qty": 1, "category": "toktok"}, {"name": "حلزونه كامله درجه", "shelf": "13 شمال", "buyPrice": 60, "sellPrice": 72, "qty": 2, "category": "toktok"}, {"name": "حله اندرياس درجه", "shelf": "15 شمال", "buyPrice": 135, "sellPrice": 162, "qty": 3, "category": "toktok"}, {"name": "حله دبرياج اصلى", "shelf": "15 شمال", "buyPrice": 175, "sellPrice": 210, "qty": 5, "category": "toktok"}, {"name": "حله دبرياج اندرياس", "shelf": "غير محدد", "buyPrice": 110, "sellPrice": 154, "qty": 2, "category": "toktok"}, {"name": "خابور كرنك", "shelf": "شمال 3", "buyPrice": 5, "sellPrice": 6, "qty": 18, "category": "toktok"}, {"name": "خرطوم بنزين", "shelf": "يمين 4", "buyPrice": 10, "sellPrice": 12, "qty": 1, "category": "toktok"}, {"name": "خزنه فرامل اندرياس خلفي", "shelf": "غير محدد", "buyPrice": 148, "sellPrice": 208, "qty": 2, "category": "toktok"}, {"name": "خوصه دلايه", "shelf": "يمين 11", "buyPrice": 25, "sellPrice": 30, "qty": 7, "category": "toktok"}, {"name": "داخلى قمرة قميص كوتش", "shelf": "يمين 47", "buyPrice": 100, "sellPrice": 120, "qty": 4, "category": "toktok"}, {"name": "دبابه اصلى", "shelf": "خلفي 2", "buyPrice": 70, "sellPrice": 84, "qty": 19, "category": "toktok"}, {"name": "دبابه تقليد الاصلى", "shelf": "خلفي 2", "buyPrice": 50, "sellPrice": 60, "qty": 5, "category": "toktok"}, {"name": "دراع بي ال 2011 اصلي", "shelf": "شمال 5", "buyPrice": 415, "sellPrice": 498, "qty": 3, "category": "toktok"}, {"name": "دراع بي ال 2011 ام بي", "shelf": "شمال 5", "buyPrice": 266, "sellPrice": 320, "qty": 1, "category": "toktok"}, {"name": "دراع بي ال 2014 اصلي", "shelf": "شمال 5", "buyPrice": 525, "sellPrice": 630, "qty": 3, "category": "toktok"}, {"name": "دراع بي ال 2014 درجه", "shelf": "شمال 5", "buyPrice": 260, "sellPrice": 312, "qty": 2, "category": "toktok"}, {"name": "دفيره سيوس اصلى 2011", "shelf": "يمين 38", "buyPrice": 1320, "sellPrice": 1584, "qty": 1, "category": "toktok"}, {"name": "دلايه بجاج اصلى", "shelf": "خلفي 1", "buyPrice": 70, "sellPrice": 84, "qty": 10, "category": "toktok"}, {"name": "دليل صباب 2011", "shelf": "4 شمال", "buyPrice": 50, "sellPrice": 60, "qty": 20, "category": "toktok"}, {"name": "دواسه امامى 2014", "shelf": "غير محدد", "buyPrice": 500, "sellPrice": 700, "qty": 3, "category": "toktok"}, {"name": "ديسك كامل 2011 اصلي", "shelf": "21 شمال", "buyPrice": 1410, "sellPrice": 1692, "qty": 2, "category": "toktok"}, {"name": "ديسك كامل اصلى 2014", "shelf": "21 شمال", "buyPrice": 1550, "sellPrice": 1860, "qty": 2, "category": "toktok"}, {"name": "ديفيره سيوس اصلى 2014", "shelf": "يمين 38", "buyPrice": 1500, "sellPrice": 1800, "qty": 1, "category": "toktok"}, {"name": "ديوان زيت 2014", "shelf": "7 شمال", "buyPrice": 30, "sellPrice": 36, "qty": 5, "category": "toktok"}, {"name": "راس شميز 2011 اصلى", "shelf": "22 شمال", "buyPrice": 1620, "sellPrice": 1944, "qty": 1, "category": "toktok"}, {"name": "راس صباب 2011 اصلى", "shelf": "22 شمال", "buyPrice": 2500, "sellPrice": 3000, "qty": 3, "category": "toktok"}, {"name": "راس صباب 2019", "shelf": "22 شمال", "buyPrice": 2375, "sellPrice": 2850, "qty": 1, "category": "toktok"}, {"name": "راس نص كاملة 2011 كود 16", "shelf": "22 شمال", "buyPrice": 1450, "sellPrice": 1740, "qty": 1, "category": "toktok"}, {"name": "راقت ديسك", "shelf": "14 شمال", "buyPrice": 55, "sellPrice": 66, "qty": 1, "category": "toktok"}, {"name": "رفرف امامي 2011 ذهب هندي", "shelf": "غير محدد", "buyPrice": 190, "sellPrice": 266, "qty": 2, "category": "toktok"}, {"name": "زرار مرش", "shelf": "يمين 4", "buyPrice": 80, "sellPrice": 96, "qty": 1, "category": "toktok"}, {"name": "زومبه دليل ماتور 2011", "shelf": "شمال 11", "buyPrice": 5, "sellPrice": 6, "qty": 15, "category": "toktok"}, {"name": "زومبه دليل ماتور 2014", "shelf": "شمال 11", "buyPrice": 8, "sellPrice": 9.6, "qty": 15, "category": "toktok"}, {"name": "زيت باكم", "shelf": "غير محدد", "buyPrice": 25, "sellPrice": 30, "qty": 16, "category": "toktok"}, {"name": "سستة مرشليه 2011", "shelf": "فوق العداد", "buyPrice": 16, "sellPrice": 19.2, "qty": 8, "category": "toktok"}, {"name": "سستة مرشليه 2014", "shelf": "فوق العداد", "buyPrice": 16, "sellPrice": 19.2, "qty": 9, "category": "toktok"}, {"name": "سسته بالطبق", "shelf": "يمين 4", "buyPrice": 50, "sellPrice": 60, "qty": 7, "category": "toktok"}, {"name": "سلك داخلى بنزين", "shelf": "شمال 3", "buyPrice": 10, "sellPrice": 15, "qty": 22, "category": "toktok"}, {"name": "سلك داخلى مرشليه", "shelf": "شمال 3", "buyPrice": 15, "sellPrice": 18, "qty": 16, "category": "toktok"}, {"name": "سلك دبرياج اوكى", "shelf": "شمال 3", "buyPrice": 10, "sellPrice": 15, "qty": 7, "category": "toktok"}, {"name": "سلك دبرياج محمل بالقفل", "shelf": "شمال 3", "buyPrice": 20, "sellPrice": 24, "qty": 5, "category": "toktok"}, {"name": "سلك موبينه", "shelf": "يمين 17", "buyPrice": 20, "sellPrice": 24, "qty": 10, "category": "toktok"}, {"name": "سوسته تقل", "shelf": "9 شمال", "buyPrice": 10, "sellPrice": 12, "qty": 20, "category": "toktok"}, {"name": "شجرة شبكة فرامل 2016", "shelf": "شمال 35", "buyPrice": 90, "sellPrice": 108, "qty": 3, "category": "toktok"}, {"name": "شجرة فرامل 2011", "shelf": "شمال 35", "buyPrice": 90, "sellPrice": 108, "qty": 3, "category": "toktok"}, {"name": "شربون فروك اصلى", "shelf": "يمين 4", "buyPrice": 45, "sellPrice": 68, "qty": 12, "category": "toktok"}, {"name": "شكمان 2011 ليفكو اصلى", "shelf": "38 شمال", "buyPrice": 870, "sellPrice": 1044, "qty": 0, "category": "toktok"}, {"name": "شكمان 2016 ليفكو اصلى", "shelf": "38 شمال", "buyPrice": 1060, "sellPrice": 1272, "qty": 1, "category": "toktok"}, {"name": "شمبر 010 مهلى 2011", "shelf": "شمال 19", "buyPrice": 250, "sellPrice": 300, "qty": 3, "category": "toktok"}, {"name": "شمبر 010 مهلى 2018", "shelf": "19 شمال", "buyPrice": 270, "sellPrice": 324, "qty": 3, "category": "toktok"}, {"name": "شمبر 020 مهلى 2011", "shelf": "19 شمال", "buyPrice": 255, "sellPrice": 306, "qty": 3, "category": "toktok"}, {"name": "شمبر 020 مهلى 2018", "shelf": "19 شمال", "buyPrice": 280, "sellPrice": 336, "qty": 3, "category": "toktok"}, {"name": "شمبر استندر 2018", "shelf": "19 شمال", "buyPrice": 255, "sellPrice": 306, "qty": 5, "category": "toktok"}, {"name": "صاموله دسك اصلى", "shelf": "غير محدد", "buyPrice": 13, "sellPrice": 19, "qty": 20, "category": "toktok"}, {"name": "صاموله ديسك 2014", "shelf": "10 شمال", "buyPrice": 20, "sellPrice": 24, "qty": 3, "category": "toktok"}, {"name": "صاموله وش سلندر 2011", "shelf": "10 شمال", "buyPrice": 10, "sellPrice": 12, "qty": 20, "category": "toktok"}, {"name": "صداده او طعميه", "shelf": "يمين 11", "buyPrice": 5, "sellPrice": 6, "qty": 140, "category": "toktok"}, {"name": "صضاضه حمرا", "shelf": "يمين 5", "buyPrice": 5, "sellPrice": 6, "qty": 83, "category": "toktok"}, {"name": "صليبه غيارات اصلى", "shelf": "غير محدد", "buyPrice": 140, "sellPrice": 196, "qty": 3, "category": "toktok"}, {"name": "صليبه غيارات فيرا هندي", "shelf": "غير محدد", "buyPrice": 45, "sellPrice": 63, "qty": 5, "category": "toktok"}, {"name": "طاسه رقبه 2011", "shelf": "يمين 18", "buyPrice": 45, "sellPrice": 54, "qty": 3, "category": "toktok"}, {"name": "طبه زيت بالمغناطيس 2016", "shelf": "شمال 3", "buyPrice": 15, "sellPrice": 18, "qty": 10, "category": "toktok"}, {"name": "طرمبه زيت اصلي", "shelf": "4 شمال", "buyPrice": 150, "sellPrice": 180, "qty": 5, "category": "toktok"}, {"name": "طرنطه امامى", "shelf": "خلفي 11", "buyPrice": 125, "sellPrice": 150, "qty": 2, "category": "toktok"}, {"name": "طرنطه خلفى", "shelf": "خلفي 11", "buyPrice": 125, "sellPrice": 150, "qty": 6, "category": "toktok"}, {"name": "طق اولسيه موتور 2014", "shelf": "9 شمال", "buyPrice": 145, "sellPrice": 174, "qty": 5, "category": "toktok"}, {"name": "طقم اشاره امامى 2014", "shelf": "23 شمال", "buyPrice": 15, "sellPrice": 18, "qty": 10, "category": "toktok"}, {"name": "طقم اشاره امامى كامل 2011", "shelf": "خلفى 5", "buyPrice": 165, "sellPrice": 198, "qty": 5, "category": "toktok"}, {"name": "طقم اصلاح ديسك", "shelf": "14 شمال", "buyPrice": 45, "sellPrice": 54, "qty": 10, "category": "toktok"}, {"name": "طقم الجون اصلي 2014", "shelf": "7 شمال", "buyPrice": 300, "sellPrice": 360, "qty": 3, "category": "toktok"}, {"name": "طقم اولسين 2014 اصلى", "shelf": "غير محدد", "buyPrice": 120, "sellPrice": 168, "qty": 4, "category": "toktok"}, {"name": "طقم اوليسه ماتور 2014", "shelf": "9 شمال", "buyPrice": 145, "sellPrice": 174, "qty": 3, "category": "toktok"}, {"name": "طقم برشام اندرياس", "shelf": "14 شمال", "buyPrice": 45, "sellPrice": 54, "qty": 9, "category": "toktok"}, {"name": "طقم بنز شاكوش 2011", "shelf": "10 شمال", "buyPrice": 55, "sellPrice": 66, "qty": 13, "category": "toktok"}, {"name": "طقم بنز شاكوش 2014", "shelf": "10 شمال", "buyPrice": 50, "sellPrice": 60, "qty": 15, "category": "toktok"}, {"name": "طقم تروس كورونا 2011", "shelf": "12 شمال", "buyPrice": 875, "sellPrice": 1050, "qty": 3, "category": "toktok"}, {"name": "طقم تروس كورونا 2022", "shelf": "12 شمال", "buyPrice": 900, "sellPrice": 1080, "qty": 1, "category": "toktok"}, {"name": "طقم جلد عجله خلفي 2011", "shelf": "9 شمال", "buyPrice": 20, "sellPrice": 24, "qty": 5, "category": "toktok"}, {"name": "طقم جلد كوبلن صغير", "shelf": "يمين 31", "buyPrice": 20, "sellPrice": 24, "qty": 20, "category": "toktok"}, {"name": "طقم جلد كوبلن كبير", "shelf": "يمين 31", "buyPrice": 100, "sellPrice": 120, "qty": 4, "category": "toktok"}, {"name": "طقم جوان 2011 درجه", "shelf": "شمال 7", "buyPrice": 65, "sellPrice": 78, "qty": 1, "category": "toktok"}, {"name": "طقم جوان 2014 اصلى", "shelf": "غير محدد", "buyPrice": 290, "sellPrice": 348, "qty": 3, "category": "toktok"}, {"name": "طقم جوان 2014 درجه", "shelf": "شمال 7", "buyPrice": 65, "sellPrice": 78, "qty": 2, "category": "toktok"}, {"name": "طقم جوان 2016 درجه", "shelf": "شمال 7", "buyPrice": 65, "sellPrice": 78, "qty": 2, "category": "toktok"}, {"name": "طقم جوان اصلي 2011", "shelf": "7 شمال", "buyPrice": 300, "sellPrice": 360, "qty": 2, "category": "toktok"}, {"name": "طقم جوان ماتور 2011", "shelf": "غير محدد", "buyPrice": 110, "sellPrice": 132, "qty": 10, "category": "toktok"}, {"name": "طقم جوان ماتور 2014", "shelf": "تحت البنك", "buyPrice": 130, "sellPrice": 156, "qty": 10, "category": "toktok"}, {"name": "طقم شاكوش 2011 اصلى", "shelf": "10 شمال", "buyPrice": 195, "sellPrice": 234, "qty": 3, "category": "toktok"}, {"name": "طقم شاكوش 2014 اصلى", "shelf": "10 شمال", "buyPrice": 370, "sellPrice": 444, "qty": 0, "category": "toktok"}, {"name": "طقم شاكوش 2018", "shelf": "10 شمال", "buyPrice": 370, "sellPrice": 444, "qty": 2, "category": "toktok"}, {"name": "طقم شداد 2011 اصلى", "shelf": "غير محدد", "buyPrice": 100, "sellPrice": 140, "qty": 3, "category": "toktok"}, {"name": "طقم شداد فبر 2011", "shelf": "17 شمال", "buyPrice": 120, "sellPrice": 144, "qty": 6, "category": "toktok"}, {"name": "طقم شداد فبر 2014", "shelf": "17 شمال", "buyPrice": 120, "sellPrice": 144, "qty": 11, "category": "toktok"}, {"name": "طقم صباب 2011 فروك اصلى", "shelf": "غير محدد", "buyPrice": 130, "sellPrice": 182, "qty": 2, "category": "toktok"}, {"name": "طقم صباب 2014 فروك اصلى", "shelf": "غير محدد", "buyPrice": 155, "sellPrice": 217, "qty": 0, "category": "toktok"}, {"name": "طقم ظرف للفرش 20 بيليه", "shelf": "29", "buyPrice": 125, "sellPrice": 150, "qty": 4, "category": "toktok"}, {"name": "طقم فانوس 2014 خلفى نيفا", "shelf": "خلفى 7", "buyPrice": 160, "sellPrice": 224, "qty": 5, "category": "toktok"}, {"name": "طقم فانوس اشارة امامى 2007", "shelf": "خلفى 3", "buyPrice": 140, "sellPrice": 168, "qty": 5, "category": "toktok"}, {"name": "طقم فانوس خلفى كامل 2011", "shelf": "خلفى 6", "buyPrice": 165, "sellPrice": 198, "qty": 3, "category": "toktok"}, {"name": "طقم لكلاش يمين وشمال", "shelf": "يمين 17", "buyPrice": 110, "sellPrice": 132, "qty": 10, "category": "toktok"}, {"name": "طقم مرايا عقل", "shelf": "خلفي 9", "buyPrice": 115, "sellPrice": 138, "qty": 3, "category": "toktok"}, {"name": "طقم مرايا فروك صينى", "shelf": "غير محدد", "buyPrice": 75, "sellPrice": 105, "qty": 2, "category": "toktok"}, {"name": "طقم مسمار عمود كامه 2014", "shelf": "شمال 11", "buyPrice": 25, "sellPrice": 30, "qty": 5, "category": "toktok"}, {"name": "طقم مقص استرلينج هندى", "shelf": "شمال 39", "buyPrice": 600, "sellPrice": 720, "qty": 1, "category": "toktok"}, {"name": "طقم وش اشاره خلفى 2011", "shelf": "يمين 29", "buyPrice": 40, "sellPrice": 48, "qty": 12, "category": "toktok"}, {"name": "طقم وش خلفى 2014 أ", "shelf": "23 شمال", "buyPrice": 40, "sellPrice": 48, "qty": 9, "category": "toktok"}, {"name": "طقم وش خلفى 2014 ب", "shelf": "يمين 22", "buyPrice": 40, "sellPrice": 48, "qty": 3, "category": "toktok"}, {"name": "طلمبه زيت بجاج اصلى", "shelf": "غير محدد", "buyPrice": 125, "sellPrice": 175, "qty": 1, "category": "toktok"}, {"name": "طمبوره بيق بون", "shelf": "خلفي 4", "buyPrice": 271, "sellPrice": 326, "qty": 2, "category": "toktok"}, {"name": "طنبوره خلفي", "shelf": "8 شمال", "buyPrice": 305, "sellPrice": 366, "qty": 0, "category": "toktok"}, {"name": "عصفور دبرياج", "shelf": "شمال 9", "buyPrice": 10, "sellPrice": 12, "qty": 5, "category": "toktok"}, {"name": "عصفوره باب خلفى", "shelf": "يمين 5", "buyPrice": 2.5, "sellPrice": 3, "qty": 100, "category": "toktok"}, {"name": "عصفوره بالمسمار", "shelf": "يمين 11", "buyPrice": 5, "sellPrice": 6, "qty": 20, "category": "toktok"}, {"name": "علبه زيت", "shelf": "27", "buyPrice": 25, "sellPrice": 30, "qty": 12, "category": "toktok"}, {"name": "علبه شحم", "shelf": "26 شمال", "buyPrice": 50, "sellPrice": 60, "qty": 2, "category": "toktok"}, {"name": "عمود كامه اصلى 2011 أ", "shelf": "غير محدد", "buyPrice": 450, "sellPrice": 630, "qty": 3, "category": "toktok"}, {"name": "عمود كامه اصلي 2011", "shelf": "شمال 5", "buyPrice": 550, "sellPrice": 660, "qty": 5, "category": "toktok"}, {"name": "عمود كامه اصلي 2014", "shelf": "شمال 5", "buyPrice": 550, "sellPrice": 660, "qty": 4, "category": "toktok"}, {"name": "عمود كامه درجه 2011", "shelf": "شمال 5", "buyPrice": 270, "sellPrice": 324, "qty": 4, "category": "toktok"}, {"name": "عمود كوبلن 2011 قصير", "shelf": "شمال 1", "buyPrice": 105, "sellPrice": 126, "qty": 4, "category": "toktok"}, {"name": "عمود كوبلن 2014 طويل", "shelf": "شمال 1", "buyPrice": 105, "sellPrice": 126, "qty": 2, "category": "toktok"}, {"name": "عمود كوبلن طويل 2011", "shelf": "شمال 1", "buyPrice": 105, "sellPrice": 126, "qty": 4, "category": "toktok"}, {"name": "غطا تكيهات 2011", "shelf": "يمين 17", "buyPrice": 40, "sellPrice": 48, "qty": 4, "category": "toktok"}, {"name": "غطا تنك 2016 هندي", "shelf": "8 شمال", "buyPrice": 35, "sellPrice": 42, "qty": 5, "category": "toktok"}, {"name": "غطا زيت قصير", "shelf": "يمين 25", "buyPrice": 15, "sellPrice": 18, "qty": 10, "category": "toktok"}, {"name": "غطا سكرتورة 2018 بلاستيك", "shelf": "يمين 3 تحت البنك", "buyPrice": 30, "sellPrice": 42, "qty": 10, "category": "toktok"}, {"name": "غطا هوايه", "shelf": "خلفى 15", "buyPrice": 35, "sellPrice": 42, "qty": 4, "category": "toktok"}, {"name": "فبره ارقام", "shelf": "يمين 18", "buyPrice": 15, "sellPrice": 18, "qty": 10, "category": "toktok"}, {"name": "فبره ماتور", "shelf": "يمين 46", "buyPrice": 260, "sellPrice": 312, "qty": 1, "category": "toktok"}, {"name": "فلانشة قرصة جنط هندى", "shelf": "يمين 38", "buyPrice": 75, "sellPrice": 90, "qty": 5, "category": "toktok"}, {"name": "فلتر بنزين صغير", "shelf": "يمين 33", "buyPrice": 10, "sellPrice": 12, "qty": 9, "category": "toktok"}, {"name": "فلتر بنزين صغير درجه", "shelf": "غير محدد", "buyPrice": 5, "sellPrice": 7, "qty": 5, "category": "toktok"}, {"name": "فلتر زيت تقليد 2014", "shelf": "يمين 22", "buyPrice": 40, "sellPrice": 48, "qty": 4, "category": "toktok"}, {"name": "فلتر زيت مربع", "shelf": "خلفى 13", "buyPrice": 100, "sellPrice": 120, "qty": 4, "category": "toktok"}, {"name": "فلشر فروك اصلي", "shelf": "يمين 4", "buyPrice": 55, "sellPrice": 66, "qty": 7, "category": "toktok"}, {"name": "فيبر البنزين", "shelf": "يمين 18", "buyPrice": 15, "sellPrice": 18, "qty": 10, "category": "toktok"}, {"name": "فيبره غيارات", "shelf": "يمين 17", "buyPrice": 20, "sellPrice": 24, "qty": 10, "category": "toktok"}, {"name": "فيشه اكتوفاير", "shelf": "يمين 25", "buyPrice": 20, "sellPrice": 24, "qty": 4, "category": "toktok"}, {"name": "فيشه فيوز", "shelf": "يمين 18", "buyPrice": 15, "sellPrice": 18, "qty": 2, "category": "toktok"}, {"name": "قاعدة مسمار ماتور امامى", "shelf": "يمين 18", "buyPrice": 25, "sellPrice": 30, "qty": 5, "category": "toktok"}, {"name": "قاعده الكرتونه 2007 اصلي", "shelf": "6 شمال", "buyPrice": 200, "sellPrice": 240, "qty": 5, "category": "toktok"}, {"name": "قاعده سكرتور الاصلي 2016", "shelf": "6 شمال", "buyPrice": 160, "sellPrice": 192, "qty": 3, "category": "toktok"}, {"name": "قاعده ماتور خلفى", "shelf": "يمين 25", "buyPrice": 50, "sellPrice": 60, "qty": 3, "category": "toktok"}, {"name": "قربه باكم", "shelf": "12 شمال", "buyPrice": 65, "sellPrice": 78, "qty": 5, "category": "toktok"}, {"name": "قفل دبرياج", "shelf": "يمين 5", "buyPrice": 5, "sellPrice": 6, "qty": 100, "category": "toktok"}, {"name": "قله مارش 2011", "shelf": "يمين 12", "buyPrice": 80, "sellPrice": 96, "qty": 3, "category": "toktok"}, {"name": "قله مرش 2014", "shelf": "يمين 12", "buyPrice": 85, "sellPrice": 102, "qty": 3, "category": "toktok"}, {"name": "قورصه جنط", "shelf": "خلفي 9", "buyPrice": 90, "sellPrice": 108, "qty": 1, "category": "toktok"}, {"name": "قوله ستوليك 2020 فيرا", "shelf": "غير محدد", "buyPrice": 230, "sellPrice": 322, "qty": 2, "category": "toktok"}, {"name": "كالون تنك الفا", "shelf": "يمين 4", "buyPrice": 35, "sellPrice": 42, "qty": 5, "category": "toktok"}, {"name": "كالون دورج الفا", "shelf": "يمين 4", "buyPrice": 35, "sellPrice": 42, "qty": 10, "category": "toktok"}, {"name": "كتله مارش 2011", "shelf": "يمين 14", "buyPrice": 225, "sellPrice": 270, "qty": 5, "category": "toktok"}, {"name": "كتله مارش كامله", "shelf": "يمين 12", "buyPrice": 225, "sellPrice": 270, "qty": 3, "category": "toktok"}, {"name": "كتله يمين 2011", "shelf": "يمين 13", "buyPrice": 155, "sellPrice": 186, "qty": 4, "category": "toktok"}, {"name": "كتله يمين 2014 ميندا", "shelf": "غير محدد", "buyPrice": 125, "sellPrice": 175, "qty": 2, "category": "toktok"}, {"name": "كتينه 2013 اصلى", "shelf": "غير محدد", "buyPrice": 100, "sellPrice": 140, "qty": 4, "category": "toktok"}, {"name": "كتينه 2014 عقله وعقله", "shelf": "غير محدد", "buyPrice": 125, "sellPrice": 175, "qty": 1, "category": "toktok"}, {"name": "كحكة شكمان صغيره", "shelf": "يمين 11", "buyPrice": 5, "sellPrice": 6, "qty": 20, "category": "toktok"}, {"name": "كحكة شكمان كبيره", "shelf": "يمين 11", "buyPrice": 5, "sellPrice": 6, "qty": 60, "category": "toktok"}, {"name": "كربراتير 2007 اصلى", "shelf": "يمين 20", "buyPrice": 835, "sellPrice": 1002, "qty": 0, "category": "toktok"}, {"name": "كربراتير بوكال 2011", "shelf": "يمين 20", "buyPrice": 820, "sellPrice": 984, "qty": 2, "category": "toktok"}, {"name": "كربرتير 2011 فروك صينى", "shelf": "يمين 20", "buyPrice": 500, "sellPrice": 600, "qty": 0, "category": "toktok"}, {"name": "كليبس سن صاج", "shelf": "شمال 3", "buyPrice": 4, "sellPrice": 5, "qty": 100, "category": "toktok"}, {"name": "كوباية زيت 2011", "shelf": "يمين 30", "buyPrice": 55, "sellPrice": 66, "qty": 6, "category": "toktok"}, {"name": "كوبايه كوبلن 2014", "shelf": "يمين 6", "buyPrice": 105, "sellPrice": 126, "qty": 5, "category": "toktok"}, {"name": "كوبايه كوبلن صغيره 2014", "shelf": "يمين 6", "buyPrice": 90, "sellPrice": 108, "qty": 11, "category": "toktok"}, {"name": "كوبايه كوبلن كبيره", "shelf": "يمين 6", "buyPrice": 105, "sellPrice": 126, "qty": 7, "category": "toktok"}, {"name": "كوبايه وسط", "shelf": "يمين 6", "buyPrice": 105, "sellPrice": 126, "qty": 6, "category": "toktok"}, {"name": "كوبايه وسط 2011", "shelf": "يمين 6", "buyPrice": 105, "sellPrice": 126, "qty": 3, "category": "toktok"}, {"name": "كوتش براميدز مصرى", "shelf": "غير محدد", "buyPrice": 625, "sellPrice": 750, "qty": 3, "category": "toktok"}, {"name": "كوتش بكستانى لانق لايف", "shelf": "غير محدد", "buyPrice": 650, "sellPrice": 780, "qty": 3, "category": "toktok"}, {"name": "كوتش شركه", "shelf": "داخل", "buyPrice": 800, "sellPrice": 897, "qty": 3, "category": "toktok"}, {"name": "كوتش مترو هندى", "shelf": "غير محدد", "buyPrice": 850, "sellPrice": 1020, "qty": 1, "category": "toktok"}, {"name": "كونتاك فروك اصلى", "shelf": "يمين 4", "buyPrice": 180, "sellPrice": 216, "qty": 5, "category": "toktok"}, {"name": "كونتاك فروك صيني", "shelf": "يمين 4", "buyPrice": 130, "sellPrice": 156, "qty": 1, "category": "toktok"}, {"name": "لافي غيارات وعمود سكرتوره", "shelf": "شمال 6", "buyPrice": 175, "sellPrice": 245, "qty": 5, "category": "toktok"}, {"name": "لافيه غيارات 2014 اصلي", "shelf": "شمال 4", "buyPrice": 170, "sellPrice": 204, "qty": 4, "category": "toktok"}, {"name": "لافيه مرشليه", "shelf": "شمال 5", "buyPrice": 12, "sellPrice": 15, "qty": 10, "category": "toktok"}, {"name": "لافيه مرشليه 2014 اصلي", "shelf": "4 شمال", "buyPrice": 155, "sellPrice": 186, "qty": 3, "category": "toktok"}, {"name": "لاقط 2011", "shelf": "يمين 18", "buyPrice": 200, "sellPrice": 240, "qty": 7, "category": "toktok"}, {"name": "لاقط مرش 2014", "shelf": "يمين 18", "buyPrice": 210, "sellPrice": 252, "qty": 2, "category": "toktok"}, {"name": "لجلاش سكارتورة فتيس 8", "shelf": "شمال 18", "buyPrice": 4, "sellPrice": 4.8, "qty": 100, "category": "toktok"}, {"name": "لقمه كوبلن لكش اصلى 2018", "shelf": "يمين 7", "buyPrice": 25, "sellPrice": 30, "qty": 20, "category": "toktok"}, {"name": "لقمه كوبلن لكش اصلي 2011", "shelf": "يمين 7", "buyPrice": 20, "sellPrice": 24, "qty": 20, "category": "toktok"}, {"name": "مارش 2014 صيني", "shelf": "يمين 13", "buyPrice": 850, "sellPrice": 1020, "qty": 1, "category": "toktok"}, {"name": "ماستر عمومى 2011 اندرياس", "shelf": "يمين 37", "buyPrice": 475, "sellPrice": 665, "qty": 1, "category": "toktok"}, {"name": "ماستر عمومى 2014 اندرياس", "shelf": "يمين 37", "buyPrice": 450, "sellPrice": 630, "qty": 1, "category": "toktok"}, {"name": "ماسورة شكمان 2011", "shelf": "40 شمال", "buyPrice": 220, "sellPrice": 264, "qty": 2, "category": "toktok"}, {"name": "ماسورة شكمان 2016", "shelf": "40 شمال", "buyPrice": 380, "sellPrice": 456, "qty": 2, "category": "toktok"}, {"name": "متوسيكل G K", "shelf": "تحت", "buyPrice": 550, "sellPrice": 660, "qty": 4, "category": "battery"}, {"name": "متوسيكل دايو", "shelf": "تحت", "buyPrice": 680, "sellPrice": 816, "qty": 3, "category": "battery"}, {"name": "متوسيكل منشى", "shelf": "تحت البنك", "buyPrice": 680, "sellPrice": 816, "qty": 3, "category": "battery"}, {"name": "مجموعه ستوليك فيرا اصلي", "shelf": "12 شمال", "buyPrice": 270, "sellPrice": 324, "qty": 4, "category": "toktok"}, {"name": "مجموعه سيتوليك 2011", "shelf": "12 شمال", "buyPrice": 240, "sellPrice": 288, "qty": 5, "category": "toktok"}, {"name": "مرش اوكى 2011", "shelf": "يمين 13", "buyPrice": 985, "sellPrice": 1182, "qty": 2, "category": "toktok"}, {"name": "مساعد امامى جبريل", "shelf": "31 شمال", "buyPrice": 250, "sellPrice": 350, "qty": 3, "category": "toktok"}, {"name": "مساعد خلفى", "shelf": "24 شمال", "buyPrice": 300, "sellPrice": 360, "qty": 4, "category": "toktok"}, {"name": "مسمار اكس", "shelf": "يمين 5", "buyPrice": 20, "sellPrice": 24, "qty": 25, "category": "toktok"}, {"name": "مسمار جنط", "shelf": "يمين 5", "buyPrice": 10, "sellPrice": 12, "qty": 89, "category": "toktok"}, {"name": "مسمار دقاق اصلى", "shelf": "12 شمال", "buyPrice": 70, "sellPrice": 84, "qty": 20, "category": "toktok"}, {"name": "مسمار شاكوش بالصاموله", "shelf": "9 شمال", "buyPrice": 20, "sellPrice": 24, "qty": 20, "category": "toktok"}, {"name": "مسمار ماتور بدون جلد", "shelf": "يمين 5", "buyPrice": 10, "sellPrice": 12, "qty": 19, "category": "toktok"}, {"name": "مسمار مرش", "shelf": "يمين 5", "buyPrice": 10, "sellPrice": 12, "qty": 5, "category": "toktok"}, {"name": "مسمار مقبض دبرياج", "shelf": "شمال 9", "buyPrice": 5, "sellPrice": 6, "qty": 100, "category": "toktok"}, {"name": "مسمار مقص بالجلب هندى", "shelf": "شمال 1", "buyPrice": 140, "sellPrice": 168, "qty": 4, "category": "toktok"}, {"name": "مسمار مقص هندى بدون جلب", "shelf": "شمال 1", "buyPrice": 60, "sellPrice": 72, "qty": 4, "category": "toktok"}, {"name": "مشبك ستاره توكتوك", "shelf": "يمين 5", "buyPrice": 15, "sellPrice": 18, "qty": 2, "category": "toktok"}, {"name": "مصفه زيت 2011", "shelf": "9 شمال", "buyPrice": 15, "sellPrice": 18, "qty": 20, "category": "toktok"}, {"name": "مصفه زيت 2011 الاتحاد", "shelf": "غير محدد", "buyPrice": 10, "sellPrice": 14, "qty": 50, "category": "toktok"}, {"name": "مصفه زيت 2014", "shelf": "9 شمال", "buyPrice": 35, "sellPrice": 42, "qty": 10, "category": "toktok"}, {"name": "مغانطيس 2014 باجلا", "shelf": "غير محدد", "buyPrice": 460, "sellPrice": 644, "qty": 1, "category": "toktok"}, {"name": "مغانطيس بالترس 2018 باجلا", "shelf": "غير محدد", "buyPrice": 460, "sellPrice": 644, "qty": 1, "category": "toktok"}, {"name": "مفتاح بوجيه", "shelf": "يمين 19", "buyPrice": 25, "sellPrice": 30, "qty": 5, "category": "toktok"}, {"name": "مقاس يت", "shelf": "يمين 25", "buyPrice": 15, "sellPrice": 18, "qty": 11, "category": "toktok"}, {"name": "مقبض دبرياج اصلى", "shelf": "يمين 25", "buyPrice": 55, "sellPrice": 66, "qty": 10, "category": "toktok"}, {"name": "مقص يمين فروك شمال", "shelf": "شمال 37", "buyPrice": 650, "sellPrice": 780, "qty": 1, "category": "toktok"}, {"name": "مكنه تنوير او مكنه استوب", "shelf": "12 شمال", "buyPrice": 60, "sellPrice": 72, "qty": 5, "category": "toktok"}, {"name": "ملف شحن بقلا هندي 2014", "shelf": "يمين 10", "buyPrice": 420, "sellPrice": 504, "qty": 2, "category": "toktok"}, {"name": "ملف شحن فروك اصلي", "shelf": "يمين 10", "buyPrice": 550, "sellPrice": 660, "qty": 2, "category": "toktok"}, {"name": "منخار 2011", "shelf": "السلم", "buyPrice": 45, "sellPrice": 54, "qty": 3, "category": "toktok"}, {"name": "منخار 2016", "shelf": "السلم", "buyPrice": 85, "sellPrice": 102, "qty": 2, "category": "toktok"}, {"name": "منفو كربرتير 2011", "shelf": "يمين 22", "buyPrice": 110, "sellPrice": 132, "qty": 2, "category": "toktok"}, {"name": "منفو كربيرتير 2016 اصلى", "shelf": "غير محدد", "buyPrice": 90, "sellPrice": 126, "qty": 1, "category": "toktok"}, {"name": "موبينة مارش بالشربون اوكى", "shelf": "يمين 15", "buyPrice": 210, "sellPrice": 294, "qty": 2, "category": "toktok"}, {"name": "موبينه تكرير 2014 اصلى", "shelf": "يمين 21", "buyPrice": 180, "sellPrice": 216, "qty": 2, "category": "toktok"}, {"name": "موبينه تكرير اصلى 2011", "shelf": "يمين 21", "buyPrice": 180, "sellPrice": 216, "qty": 1, "category": "toktok"}, {"name": "موبينه تكرير درجه 2011", "shelf": "يمين 21", "buyPrice": 150, "sellPrice": 180, "qty": 3, "category": "toktok"}, {"name": "موبينه تكرير درجه 2016", "shelf": "يمين 21", "buyPrice": 150, "sellPrice": 180, "qty": 4, "category": "toktok"}, {"name": "موبينه مارش فروق اصلى", "shelf": "يمين 15", "buyPrice": 425, "sellPrice": 510, "qty": 0, "category": "toktok"}, {"name": "موبينه مارش فروك تقليد", "shelf": "يمين 15", "buyPrice": 255, "sellPrice": 306, "qty": 2, "category": "toktok"}, {"name": "موبينه مارش فينى", "shelf": "يمين 15", "buyPrice": 375, "sellPrice": 450, "qty": 2, "category": "toktok"}, {"name": "نص ديسك اصلي", "shelf": "14 شمال", "buyPrice": 855, "sellPrice": 1026, "qty": 1, "category": "toktok"}, {"name": "نص ديسك اندرياس", "shelf": "14 شمال", "buyPrice": 590, "sellPrice": 708, "qty": 4, "category": "toktok"}, {"name": "نص طقم جوان 2007", "shelf": "شمال 2", "buyPrice": 20, "sellPrice": 24, "qty": 15, "category": "toktok"}, {"name": "نص طقم جوان 2007 عمولة", "shelf": "شمال 2", "buyPrice": 29, "sellPrice": 35, "qty": 10, "category": "toktok"}, {"name": "نص طقم جوان 2011", "shelf": "شمال 2", "buyPrice": 20, "sellPrice": 24, "qty": 3, "category": "toktok"}, {"name": "نص طقم جوان 2011 عمولة", "shelf": "شمال 2", "buyPrice": 29, "sellPrice": 35, "qty": 9, "category": "toktok"}, {"name": "نص طقم جوان 2014", "shelf": "شمال 2", "buyPrice": 20, "sellPrice": 24, "qty": 8, "category": "toktok"}, {"name": "نص طقم جوان عمولة 2014", "shelf": "تحت البنك", "buyPrice": 37, "sellPrice": 44.4, "qty": 10, "category": "toktok"}, {"name": "نص كتله فروك صينى", "shelf": "يمين 13", "buyPrice": 110, "sellPrice": 132, "qty": 5, "category": "toktok"}, {"name": "نهايه مرش صينى بالشربون", "shelf": "يمين 12", "buyPrice": 80, "sellPrice": 96, "qty": 1, "category": "toktok"}, {"name": "نهايه مرش فاضيه اصلى", "shelf": "يمين 12", "buyPrice": 80, "sellPrice": 96, "qty": 1, "category": "toktok"}, {"name": "نهايه مرش فاضيه صينى", "shelf": "يمين 12", "buyPrice": 50, "sellPrice": 60, "qty": 3, "category": "toktok"}, {"name": "نهايه مرش كامله فروك اصلى", "shelf": "غير محدد", "buyPrice": 135, "sellPrice": 189, "qty": 9, "category": "toktok"}, {"name": "وردة تروس بروحين اصلى", "shelf": "شمال 11", "buyPrice": 13, "sellPrice": 15.6, "qty": 10, "category": "toktok"}, {"name": "ورده سيتوليك", "shelf": "9 شمال", "buyPrice": 20, "sellPrice": 24, "qty": 20, "category": "toktok"}, {"name": "ورده كوبلن هندى", "shelf": "يمين 5", "buyPrice": 5, "sellPrice": 6, "qty": 48, "category": "toktok"}, {"name": "ورده مسافه 2014", "shelf": "10 شمال", "buyPrice": 20, "sellPrice": 24, "qty": 25, "category": "toktok"}, {"name": "ورده نحاس", "shelf": "يمين 5", "buyPrice": 2, "sellPrice": 2.4, "qty": 38, "category": "toktok"}, {"name": "ورق دبرياج اصلى 2014", "shelf": "15 شمال", "buyPrice": 295, "sellPrice": 354, "qty": 5, "category": "toktok"}, {"name": "ورق دبرياج اندرياس 2014", "shelf": "15 شمال", "buyPrice": 160, "sellPrice": 192, "qty": 6, "category": "toktok"}, {"name": "وسط ماتش اصلي", "shelf": "يمين 14", "buyPrice": 125, "sellPrice": 150, "qty": 4, "category": "toktok"}, {"name": "وسط مارش صيني", "shelf": "يمين 14", "buyPrice": 80, "sellPrice": 96, "qty": 2, "category": "toktok"}, {"name": "وش اشاره خلفى 2011", "shelf": "خلفي 6", "buyPrice": 165, "sellPrice": 198, "qty": 4, "category": "toktok"}, {"name": "وش جنط", "shelf": "خلفي 2", "buyPrice": 90, "sellPrice": 108, "qty": 4, "category": "toktok"}, {"name": "وش فانوس احمر", "shelf": "خلفي 10", "buyPrice": 91, "sellPrice": 110, "qty": 4, "category": "toktok"}, {"name": "وش فانوس صاج", "shelf": "خلفي 6", "buyPrice": 29, "sellPrice": 35, "qty": 10, "category": "toktok"}, {"name": "ياى او سستة مساعد", "shelf": "30", "buyPrice": 240, "sellPrice": 288, "qty": 4, "category": "toktok"}];
const ADMIN_PWD = "1234"; // غيّر كلمة المرور
const WA_NUMBER = "201024306764"; // رقم واتساب المحل
const GLOBAL_PROFIT_KEY = "gp_v3";
let globalProfit = +localStorage.getItem(GLOBAL_PROFIT_KEY)||0;

// ════════════════════════════════════════════
// DATABASE — IndexedDB ToktokShopV3
// ════════════════════════════════════════════
let db, products=[], customers=[], invoices=[], auditLog=[], suppliers=[];

const dbOp=(store,op,data)=>new Promise((res,rej)=>{
  const tx=db.transaction(store,'readwrite');
  const req=tx.objectStore(store)[op](data);
  req.onsuccess=()=>res(req.result);
  req.onerror=()=>rej(req.error);
});
const dbAll=store=>new Promise((res,rej)=>{
  const req=db.transaction(store,'readonly').objectStore(store).getAll();
  req.onsuccess=()=>res(req.result||[]);
  req.onerror=()=>rej(req.error);
});
const dbAdd=(s,d)=>dbOp(s,'add',d).then(id=>{
  // Firebase sync في الخلفية
  if(fbEnabled && FB_STORES[s]) fbPush(s,{...d,id});
  return id;
});
const dbPut=(s,d)=>dbOp(s,'put',d).then(r=>{
  if(fbEnabled && FB_STORES[s]) fbPush(s,d);
  return r;
});
const dbDel=(s,id)=>dbOp(s,'delete',id);


async function audit(action,before,after){
  await dbAdd('auditLog',{
    action,
    before:typeof before==='object'?JSON.stringify(before):before,
    after:typeof after==='object'?JSON.stringify(after):after,
    time:new Date().toLocaleString('ar-EG'),
    ts:Date.now()
  });
}

// ════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════
let toastT;
function toast(msg,type='ok'){
  const el=document.getElementById('toast');
  el.textContent=msg;el.className='show'+(type==='err'?' err':'');
  clearTimeout(toastT);toastT=setTimeout(()=>el.className='',2800);
}
function om(id){const e=document.getElementById(id);if(e)e.classList.add('open');}
function cm(id){const e=document.getElementById(id);if(e)e.classList.remove('open');}

// ════════════════════════════════════════════
// NAVIGATION (SPA)
// ════════════════════════════════════════════
function showSection(sec){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.sb-btn').forEach(b=>b.classList.remove('active'));
  const el=document.getElementById('sec-'+sec);
  if(el) el.classList.add('active');
  const btn=document.getElementById('sb-'+sec);
  if(btn) btn.classList.add('active');
  closeMobileSidebar();
  if(sec==='home'){renderHome();renderDailyReport();}
  if(sec==='inventory'){renderInv();refreshShelfSel('invShelf');}
  if(sec==='sales'){refreshShelfSel('sShelf');renderTodaySales();}
  if(sec==='customers') renderCusts();
  if(sec==='invoices') renderInvoices();
  if(sec==='audit') renderAuditLog();
  if(sec==='backup') renderAuditPreview();
  if(sec==='suppliers') renderSuppliers();
  if(sec==='settings'){ renderSettings(); }
  if(sec==='shortages'){ renderShortagesTable(); }
}

function toggleMobileSidebar(){
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}
function closeMobileSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

// ════════════════════════════════════════════
// CATEGORIES
// ════════════════════════════════════════════
const CAT_KW={
  battery:['بطارية','بطاريات','متوسيكل','ايماكس','منشى','اكسون','فولت','دايو','G K'],
  key:['مفتاح','مفاتيح','نسخ','كالون']
};
function getCat(p){
  if(p.category&&p.category!=='other') return p.category;
  const nm=(p.name||'').toLowerCase();
  if(CAT_KW.battery.some(k=>nm.includes(k.toLowerCase()))) return 'battery';
  if(CAT_KW.key.some(k=>nm.includes(k.toLowerCase()))) return 'key';
  return 'toktok';
}
function getCatBadge(cat){
  return {
    battery:'<span class="bb-b">🔋 بطارية</span>',
    key:'<span class="bo-b">🔑 مفاتيح</span>',
    toktok:'<span class="bb-b" style="background:rgba(24,200,240,.08)">🛺 توك توك</span>',
    other:'<span class="bg-b" style="background:var(--s3)">📦</span>'
  }[cat]||'';
}

// ════════════════════════════════════════════
// GLOBAL PROFIT
// ════════════════════════════════════════════
function changeGP(delta){
  const inp=document.getElementById('gpVal');
  const v=Math.max(-50,Math.min(200,(+inp.value||0)+delta));
  inp.value=v;
  document.getElementById('gpLabel').textContent=(v>=0?'+':'')+v+'%';
}
async function applyGlobalProfit(){
  const gp=+document.getElementById('gpVal').value||0;
  globalProfit=gp;
  localStorage.setItem(GLOBAL_PROFIT_KEY,gp);
  // تطبيق المعادلة: finalPrice = basePrice + (basePrice * (productProfit+globalProfit)/100)
  const active=products.filter(p=>!p.archived);
  if(!confirm(`تطبيق ربح عالمي ${gp>=0?'+':''}${gp}% على ${active.length} منتج؟\nالمعادلة: سعرالبيع = سعرالشراء × (ربحالمنتج + ${gp}%) / 100`)) return;
  for(const p of active){
    if(p.buyPrice>0){
      const pp=p.productProfit||20;
      p.sellPrice=Math.round(p.buyPrice*(1+(pp+gp)/100)*100)/100;
      p.price=p.sellPrice;
      p.lastUpdated=Date.now();
      await dbPut('products',p);
    }
  }
  await loadAll(); renderInv();
  await audit('تطبيق ربح عالمي',`قبل: gp=${globalProfit-gp}`,`بعد: gp=${gp}`);
  toast(`✅ تم تطبيق ربح عالمي ${gp>=0?'+':''}${gp}%`);
}

// ════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════
function renderHome(){
  const today=new Date().toLocaleDateString('ar-EG');
  const todayInv=invoices.filter(i=>(i.date||'').startsWith(today)&&i.product!=='سداد دين'&&!i.archived);
  const todaySales=todayInv.reduce((s,i)=>s+(i.grandTotal||i.total||0),0);
  const totalDebt=customers.reduce((s,c)=>s+(c.debt||0),0);
  const active=products.filter(p=>!p.archived);
  const low=active.filter(p=>p.qty>0&&p.qty<=(p.minQty||3)).length;
  const out=active.filter(p=>p.qty===0).length;
  document.getElementById('hs-prods').textContent=active.length;
  document.getElementById('hs-sales').textContent=todaySales.toLocaleString()+' ج';
  document.getElementById('hs-debt').textContent=totalDebt.toLocaleString()+' ج';
  document.getElementById('hs-renew').textContent=low+out;
  // تنبيهات
  const alerts=active.filter(p=>p.qty===0||(p.qty>0&&p.qty<=(p.minQty||3))).slice(0,4);
  document.getElementById('homeAlerts').innerHTML=alerts.map(p=>
    p.qty===0
    ?`<div class="alert-out">❌ <b>${p.name}</b> — نفذ من المخزن!</div>`
    :`<div class="alert-low">⚠️ <b>${p.name}</b> — الكمية منخفضة (${p.qty})</div>`
  ).join('');
  // آخر العمليات
  const recent=[...invoices].filter(i=>!i.archived).sort((a,b)=>(b.id||0)-(a.id||0)).slice(0,6);
  document.getElementById('recentOps').innerHTML=recent.length
    ?recent.map(i=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--brd);font-size:.78rem"><div><b>${i.customer}</b><span style="color:var(--muted);font-size:.68rem"> — ${i.product||'فاتورة'}</span></div><span style="color:var(--green);font-weight:700">${i.grandTotal||i.total||0} ج</span></div>`).join('')
    :'<div class="empty"><div class="empty-ic">📋</div><p>لا توجد عمليات بعد</p></div>';
  updateSidebarStats();
}

function renderDailyReport(){
  const today=new Date().toLocaleDateString('ar-EG');
  document.getElementById('dbDate').textContent=today;
  const tod=invoices.filter(i=>(i.date||'').startsWith(today)&&i.product!=='سداد دين'&&!i.archived);
  const allT=tod.reduce((s,i)=>s+(i.grandTotal||i.total||0),0);
  const batT=tod.filter(i=>getCat({name:i.product,category:i.category})==='battery');
  const keyT=tod.filter(i=>getCat({name:i.product,category:i.category})==='key');
  const bTotal=batT.reduce((s,i)=>s+(i.total||0),0);
  const kTotal=keyT.reduce((s,i)=>s+(i.total||0),0);
  document.getElementById('db-sales').textContent=allT.toLocaleString()+' ج';
  document.getElementById('db-bat').textContent=bTotal.toLocaleString()+' ج';
  document.getElementById('db-key').textContent=kTotal.toLocaleString()+' ج';
  document.getElementById('rep-all').textContent=allT.toLocaleString()+' ج';
  document.getElementById('rep-bat').textContent=bTotal.toLocaleString()+' ج';
  document.getElementById('rep-key').textContent=kTotal.toLocaleString()+' ج';
  const nd='<div style="font-size:.73rem;color:var(--muted);padding:5px 0">لا توجد مبيعات اليوم</div>';
  document.getElementById('rep-bat-list').innerHTML=batT.length?batT.map(i=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--brd);font-size:.76rem"><span>${i.product} — ${i.customer}</span><b style="color:var(--green)">${i.total} ج</b></div>`).join(''):nd;
  document.getElementById('rep-key-list').innerHTML=keyT.length?keyT.map(i=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--brd);font-size:.76rem"><span>${i.product} — ${i.customer}</span><b style="color:var(--orange)">${i.total} ج</b></div>`).join(''):nd;
}

function updateSidebarStats(){
  const active=products.filter(p=>!p.archived);
  document.getElementById('sb-all').textContent=active.length;
  document.getElementById('sb-tok').textContent=active.filter(p=>getCat(p)==='toktok').length;
  document.getElementById('sb-bat').textContent=active.filter(p=>getCat(p)==='battery').length;
  document.getElementById('sb-key').textContent=active.filter(p=>getCat(p)==='key').length;
  document.getElementById('sb-low').textContent=active.filter(p=>p.qty>0&&p.qty<=(p.minQty||3)).length;
  document.getElementById('sb-out').textContent=active.filter(p=>p.qty===0).length;
}

// ════════════════════════════════════════════
// INVENTORY
// ════════════════════════════════════════════
let curCat='all';
function setCat(cat){
  curCat=cat;
  document.querySelectorAll('.catbtn').forEach(b=>b.classList.remove('on'));
  const cb=document.getElementById('cat-'+cat);if(cb)cb.classList.add('on');
  const titles={all:'📋 جميع المنتجات',toktok:'🛺 قطع التوك توك',battery:'🔋 البطاريات',key:'🔑 المفاتيح',low:'⚠️ منخفض',out:'❌ نفذ'};
  const ti=document.getElementById('invTitle');if(ti)ti.textContent=titles[cat]||'📋 المنتجات';
  const _impBtn=document.getElementById('importBtn'); if(_impBtn) _impBtn.style.display=cat==='key'?'none':'';
  const _invCnt=document.getElementById('invContent'); if(_invCnt) _invCnt.style.display=cat==='key'?'none':'';
  const _keyMsg=document.getElementById('keyMsg'); if(_keyMsg) _keyMsg.style.display=cat==='key'?'block':'none';
  if(cat!=='key') renderInv();
}

function updateCounts(){
  const a=products.filter(p=>!p.archived);
  document.getElementById('cnt-all').textContent=a.length;
  document.getElementById('cnt-toktok').textContent=a.filter(p=>getCat(p)==='toktok').length;
  document.getElementById('cnt-battery').textContent=a.filter(p=>getCat(p)==='battery').length;
  document.getElementById('cnt-key').textContent=a.filter(p=>getCat(p)==='key').length;
  document.getElementById('cnt-low').textContent=a.filter(p=>p.qty>0&&p.qty<=(p.minQty||3)).length;
  document.getElementById('cnt-out').textContent=a.filter(p=>p.qty===0).length;
  updateSidebarStats();
}

function renderInv(){
  updateCounts();
  const q=(document.getElementById('invQ')?.value||'').toLowerCase();
  const sh=document.getElementById('invShelf')?.value||'';
  let f=products.filter(p=>{
    if(p.archived) return false;
    const mq=!q||(p.name||'').toLowerCase().includes(q)||(p.code||'').toLowerCase().includes(q)||(p.shelf||'').toLowerCase().includes(q);
    return mq&&(!sh||p.shelf===sh);
  });
  if(curCat!=='all') f=f.filter(p=>{
    if(curCat==='low') return p.qty>0&&p.qty<=(p.minQty||3);
    if(curCat==='out') return p.qty===0;
    return getCat(p)===curCat;
  });
  f.sort((a,b)=>a.name.localeCompare(b.name,'ar'));
  document.getElementById('invTbl').innerHTML=f.length?f.map(p=>{
    const st=p.qty===0?'<span class="br-b">نفذ</span>':p.qty<=(p.minQty||3)?'<span class="bo-b">منخفض</span>':'<span class="bg-b">متاح</span>';
    const img=p.image?`<img src="${p.image}" style="width:30px;height:30px;border-radius:5px;object-fit:cover;flex-shrink:0">`:`<div style="width:30px;height:30px;border-radius:5px;background:var(--s2);display:flex;align-items:center;justify-content:center;font-size:.85rem;flex-shrink:0">📦</div>`;
    return `<tr>
      <td><div style="display:flex;align-items:center;gap:7px">${img}<div><b style="font-size:.76rem">${p.name}</b>${p.code?`<br><code style="font-size:.6rem;color:var(--muted)">${p.code}</code>`:''}</div></div></td>
      <td>${getCatBadge(getCat(p))}</td>
      <td style="font-size:.7rem;color:var(--muted);white-space:nowrap">${p.shelf||'—'}</td>
      <td style="font-weight:700;color:${p.qty<=(p.minQty||3)?'var(--orange)':'var(--text)'}">${p.qty}</td>
      <td style="font-size:.74rem;color:var(--muted)">${p.buyPrice||0} ج</td>
      <td style="font-weight:700;white-space:nowrap;color:var(--green)">${p.sellPrice||0} ج</td>
      <td>${st}</td>
      <td style="white-space:nowrap">
        <button class="btn bgh bxs" onclick="openEdit(${p.id})">✏️</button>
        <button class="btn bxs" style="background:var(--rdim);color:var(--red);border:none;margin-right:3px" onclick="openAdminDel(${p.id},'product')">🗑️</button>
      </td></tr>`;
  }).join(''):`<tr><td colspan="8"><div class="empty"><div class="empty-ic">📦</div><p>لا توجد منتجات</p></div></td></tr>`;
}

function refreshShelfSel(id){
  const shelves=[...new Set(products.filter(p=>!p.archived).map(p=>p.shelf).filter(Boolean))].sort();
  const el=document.getElementById(id);if(!el) return;
  const cur=el.value;
  el.innerHTML='<option value="">كل الأرفف</option>'+shelves.map(s=>`<option value="${s}"${s===cur?' selected':''}>${s}</option>`).join('');
}

// PROFIT CALC
function calcFinalPrice(buyPrice,productProfit){
  const pp=productProfit||20;
  return Math.round(buyPrice*(1+(pp+globalProfit)/100)*100)/100;
}
function autoSell(){
  const buy=+document.getElementById('pBu').value||0;
  const pp=+document.getElementById('pPr').value||20;
  if(buy>0) document.getElementById('pSl').value=calcFinalPrice(buy,pp);
}
function autoEditSell(){
  const buy=+document.getElementById('eBu').value||0;
  const pp=+document.getElementById('ePr').value||20;
  if(buy>0) document.getElementById('eSl').value=calcFinalPrice(buy,pp);
}
function autoDetectCat(){
  const nm=(document.getElementById('pNm').value||'').toLowerCase();
  let cat='toktok';
  if(CAT_KW.battery.some(k=>nm.includes(k.toLowerCase()))) cat='battery';
  else if(CAT_KW.key.some(k=>nm.includes(k.toLowerCase()))) cat='key';
  document.getElementById('pCat').value=cat;
}
function previewImg(fid,pid,hid){
  const file=document.getElementById(fid).files[0];if(!file)return;
  const r=new FileReader();
  r.onload=e=>{
    const prev=document.getElementById(pid);prev.innerHTML='';
    const img=document.createElement('img');img.src=e.target.result;
    img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:8px';
    prev.appendChild(img);document.getElementById(hid).value=e.target.result;
  };r.readAsDataURL(file);
}
function clearImg(pid,hid){document.getElementById(pid).innerHTML='📦';document.getElementById(hid).value='';}

function openAddProd(){
  ['pNm','pCd','pSh','pBu','pSl'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('pQt').value='0';document.getElementById('pMn').value='3';
  document.getElementById('pPr').value='20';document.getElementById('pCat').value='toktok';
  document.getElementById('pImg').value='';document.getElementById('pImgPrev').innerHTML='📦';
  om('mAddP');
}

async function saveProd(){
  const name=document.getElementById('pNm').value.trim();
  if(!name){toast('أدخل اسم المنتج','err');return;}
  const buy=+document.getElementById('pBu').value||0;
  const pp=+document.getElementById('pPr').value||20;
  let sell=+document.getElementById('pSl').value||0;
  if(sell===0&&buy>0) sell=calcFinalPrice(buy,pp);
  const addQty=+document.getElementById('pQt').value||0;
  const ex=products.find(p=>p.name.trim()===name&&!p.archived);
  if(ex){
    const before={...ex};
    ex.qty+=addQty;if(buy>0)ex.buyPrice=buy;if(sell>0)ex.sellPrice=sell;
    ex.category=document.getElementById('pCat').value||ex.category;
    ex.shelf=document.getElementById('pSh').value.trim()||ex.shelf;
    ex.minQty=+document.getElementById('pMn').value||ex.minQty||3;
    ex.productProfit=pp;
    ex.code=document.getElementById('pCd').value.trim()||ex.code;
    const img=document.getElementById('pImg').value;if(img)ex.image=img;
    ex.updatedAt=new Date().toLocaleString('ar-EG');
    await dbPut('products',ex);
    await audit('تحديث منتج',before,{...ex});
    await loadAll();cm('mAddP');renderInv();refreshShelfSel('invShelf');refreshShelfSel('sShelf');
    toast(`✅ تم تحديث "${name}" — الكمية: ${ex.qty}`);
    updateDashboard();
  } else {
    const prod={name,code:document.getElementById('pCd').value.trim(),
      category:document.getElementById('pCat').value||'toktok',
      shelf:document.getElementById('pSh').value.trim()||'غير محدد',
      qty:addQty,minQty:+document.getElementById('pMn').value||3,
      buyPrice:buy,sellPrice:sell,productProfit:pp,
      image:document.getElementById('pImg').value||'',
      createdAt:new Date().toLocaleString('ar-EG')};
    await dbAdd('products',prod);
    await audit('إضافة منتج',null,name);
    await loadAll();cm('mAddP');renderInv();refreshShelfSel('invShelf');refreshShelfSel('sShelf');
    toast('✅ تم إضافة المنتج');
    updateDashboard();
  }
}

function openEdit(id){
  const p=products.find(x=>x.id===id);if(!p)return;
  document.getElementById('ePId').value=p.id;
  document.getElementById('eNm').value=p.name;
  document.getElementById('eCat').value=p.category||getCat(p);
  document.getElementById('eCd').value=p.code||'';
  document.getElementById('eSh').value=p.shelf||'';
  document.getElementById('eQt').value=p.qty;
  document.getElementById('eMn').value=p.minQty||3;
  document.getElementById('eBu').value=p.buyPrice||0;
  document.getElementById('eSl').value=p.sellPrice||0;
  document.getElementById('ePr').value=p.productProfit||20;
  document.getElementById('eImg').value=p.image||'';
  const ep=document.getElementById('eImgPrev');
  if(p.image){ep.innerHTML='';const img=document.createElement('img');img.src=p.image;img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:8px';ep.appendChild(img);}
  else ep.innerHTML='📦';
  document.getElementById('editLastUpdate').textContent=p.updatedAt?`آخر تعديل: ${p.updatedAt}`:'';
  om('mEdP');
}

async function updProd(){
  const id=+document.getElementById('ePId').value;
  const p=products.find(x=>x.id===id);if(!p)return;
  const before={...p};
  p.name=document.getElementById('eNm').value.trim();
  p.category=document.getElementById('eCat').value;
  p.code=document.getElementById('eCd').value.trim();
  p.shelf=document.getElementById('eSh').value.trim()||'غير محدد';
  p.qty=+document.getElementById('eQt').value||0;
  p.minQty=+document.getElementById('eMn').value||3;
  p.buyPrice=+document.getElementById('eBu').value||0;
  p.sellPrice=+document.getElementById('eSl').value||0;
  p.productProfit=+document.getElementById('ePr').value||20;
  const ni=document.getElementById('eImg').value;if(ni!==undefined)p.image=ni;
  p.updatedAt=new Date().toLocaleString('ar-EG');
  p.lastUpdated=Date.now();
  await dbPut('products',p);
  await audit('تعديل منتج',before,{...p});
  await loadAll();cm('mEdP');renderInv();
  toast('✅ تم التحديث');
}

async function archiveProd(id){
  const p=products.find(x=>x.id===id);if(!p)return;
  if(!confirm(`أرشفة "${p.name}"?`))return;
  p.archived=true;p.archivedAt=new Date().toLocaleString('ar-EG');
  await dbPut('products',p);
  await audit('أرشفة منتج',p.name,'مؤرشف');
  await loadAll();cm('mEdP');renderInv();
  toast(`🗄️ تم أرشفة "${p.name}"`);
}

function openAdminDel(id,type){
  document.getElementById('adminDelId').value=id;
  document.getElementById('adminDelType').value=type;
  document.getElementById('adminPwd').value='';
  om('mAdminDel');
}
async function confirmAdminDel(){
  if(document.getElementById('adminPwd').value!==ADMIN_PWD){toast('❌ كلمة المرور غلط!','err');return;}
  const id=+document.getElementById('adminDelId').value;
  const type=document.getElementById('adminDelType').value;
  const p=products.find(x=>x.id===id);
  if(!confirm(`⚠️ حذف نهائي لـ "${p?.name||id}"؟\nلا يمكن التراجع!`))return;
  await dbDel(type==='product'?'products':'invoices',id);
  await audit('حذف نهائي بإذن المدير',type+' id='+id,'محذوف');
  await loadAll();cm('mAdminDel');renderInv();renderCusts();
  toast('🗑️ تم الحذف النهائي');
}

// IMPORT ALL
async function importAll(){
  if(!confirm(`استيراد ${INV_DATA.length} صنف؟`))return;
  backupBeforeImport();
  toast('⏳ جاري الاستيراد...');
  let added=0,updated=0;
  for(let i=0;i<INV_DATA.length;i+=50){
    const batch=INV_DATA.slice(i,i+50);
    for(const p of batch){
      const ex=products.find(x=>x.name.trim()===p.name.trim()&&!x.archived);
      if(ex){ex.buyPrice=p.buyPrice;ex.sellPrice=p.sellPrice;ex.shelf=p.shelf;ex.category=p.category;ex.qty=p.qty;ex.minQty=ex.minQty||3;await dbPut('products',ex);updated++;}
      else{await dbAdd('products',{...p,code:'',minQty:3,productProfit:20});added++;}
    }
    await loadAll();
    toast(`⏳ ${Math.round((i+50)/INV_DATA.length*100)}%...`);
  }
  renderInv();refreshShelfSel('invShelf');refreshShelfSel('sShelf');updateCounts();
  await audit('استيراد مخزون',null,`${added} جديد + ${updated} تحديث`);
  toast(`✅ ${added} جديد + ${updated} تحديث`);
  renderHome();
}
// ════════════════════════════════════════════
// SALES
// ════════════════════════════════════════════
let cart=[],selProd=null,payMode='cash';
let currentInvForWA=null;

function setPay(mode){
  payMode=mode;
  ['payBtn','creditBtn','partialBtn'].forEach(id=>{const el=document.getElementById(id);if(el){el.className='btn bgh';el.style.flex='1';}});
  const a=document.getElementById(mode==='cash'?'payBtn':mode==='credit'?'creditBtn':'partialBtn');
  if(a){a.className='btn bg';a.style.flex='1';}
  const _pd=document.getElementById('partialDiv'); if(_pd) _pd.style.display=mode==='partial'?'block':'none';
  updatePartialInfo();
}
function updatePartialInfo(){
  if(payMode!=='partial')return;
  const total=cart.reduce((s,i)=>s+i.total,0);
  const paid=+document.getElementById('partialAmt').value||0;
  const rem=Math.max(0,total-paid);
  const el=document.getElementById('partialInfo');
  if(el) el.innerHTML=paid>total?'<span style="color:var(--red)">⚠️ أكبر من الإجمالي!</span>':`<span style="color:var(--green)">✅ مدفوع: ${paid} ج</span> | <span style="color:var(--red)">دين: ${rem.toFixed(2)} ج</span>`;
}
function suggestCust(){
  const q=document.getElementById('sCust').value.toLowerCase();
  const sug=document.getElementById('custSug');
  if(!q){sug.style.display='none';return;}
  const m=customers.filter(c=>c.name.toLowerCase().includes(q)).slice(0,6);
  if(!m.length){sug.style.display='none';return;}
  sug.style.display='block';
  sug.innerHTML=m.map(c=>`<div onclick="document.getElementById('sCust').value='${c.name}';document.getElementById('sPhn').value='${c.phone||''}';document.getElementById('custSug').style.display='none'" style="padding:7px 12px;cursor:pointer;border-bottom:1px solid var(--brd);font-size:.78rem">${c.name}${c.debt?`<span style="color:var(--red);font-size:.67rem"> دين: ${c.debt} ج</span>`:''}</div>`).join('');
}
function searchProds(){
  const q=(document.getElementById('sQ').value||'').toLowerCase();
  const sh=document.getElementById('sShelf')?.value||'';
  if(!q&&!sh){document.getElementById('sResults').innerHTML='';return;}
  const f=products.filter(p=>{
    if(p.archived)return false;
    const mq=!q||p.name.toLowerCase().includes(q)||(p.code||'').toLowerCase().includes(q)||(p.shelf||'').toLowerCase().includes(q);
    return mq&&(!sh||p.shelf===sh);
  }).sort((a,b)=>a.name.localeCompare(b.name,'ar')).slice(0,20);
  document.getElementById('sResults').innerHTML=f.map(p=>`<div onclick="pickProd(${p.id})" style="padding:8px 10px;background:var(--s2);border-radius:var(--rs);margin-bottom:5px;cursor:pointer;border:1px solid var(--brd);display:flex;justify-content:space-between;align-items:center">
    <div><div style="font-size:.78rem;font-weight:700">${p.name}</div><div style="font-size:.67rem;color:var(--muted)">${p.shelf||''} | <b style="color:${p.qty<=(p.minQty||3)?'var(--orange)':'var(--green)'}">${p.qty}</b> قطعة</div></div>
    <b style="color:var(--green);white-space:nowrap">${p.sellPrice} ج</b>
  </div>`).join('');
}
function pickProd(id){
  selProd=products.find(p=>p.id===id);if(!selProd)return;
  const _sb2=document.getElementById('selBar'); if(_sb2) _sb2.style.display='block';
  document.getElementById('selName').textContent=`${selProd.name} | رف: ${selProd.shelf} | متاح: ${selProd.qty}`;
  document.getElementById('selQty').value=1;
  document.getElementById('selPrice').value=selProd.sellPrice||0;
  document.getElementById('sResults').innerHTML='';
  document.getElementById('sQ').value='';
}
function addToCart(){
  if(!selProd)return;
  const qty=+document.getElementById('selQty').value||1;
  const price=+document.getElementById('selPrice').value||selProd.sellPrice||0;
  if(qty<1){toast('الكمية يجب أن تكون أكبر من صفر','err');return;}
  if(qty>selProd.qty){toast('الكمية أكبر من المتاح!','err');return;}
  const ex=cart.find(c=>c.prodId===selProd.id);
  if(ex){ex.qty+=qty;ex.total=ex.qty*ex.price;}
  else cart.push({prodId:selProd.id,name:selProd.name,shelf:selProd.shelf,qty,price,total:qty*price});
  selProd=null;
  const _sb3=document.getElementById('selBar'); if(_sb3) _sb3.style.display='none';
  renderCart();updatePartialInfo();
  toast(`✅ ${qty} قطعة في الفاتورة`);
}
function removeCart(i){cart.splice(i,1);renderCart();updatePartialInfo();}
function renderCart(){
  const total=cart.reduce((s,i)=>s+i.total,0);
  document.getElementById('cartCount').textContent=cart.length+' صنف';
  if(!cart.length){
    document.getElementById('cartItems').innerHTML='<div class="empty"><div class="empty-ic">🛒</div><p>لم تضف أصناف بعد</p></div>';
    const _cf0=document.getElementById('cartFoot'); if(_cf0) _cf0.style.display='none'; return;
  }
  document.getElementById('cartItems').innerHTML=cart.map((item,i)=>`<div class="cart-item">
    <div><div class="ci-name">${item.name}</div><div class="ci-info">${item.shelf} | ${item.qty} × ${item.price} ج</div></div>
    <div style="display:flex;align-items:center;gap:7px">
      <span class="ci-price">${fmtDisplay(item.total)} ج</span>
      <button onclick="removeCart(${i})" style="background:var(--rdim);color:var(--red);border:none;border-radius:5px;width:22px;height:22px;cursor:pointer;font-size:.76rem">✕</button>
    </div></div>`).join('');
  const _cf1=document.getElementById('cartFoot'); if(_cf1) _cf1.style.display='block';
  document.getElementById('cartTotal').textContent=fmtDisplay(total)+' جنيه';
}
function clearCart(){
  cart=[];
  ['sCust','sPhn'].forEach(id=>document.getElementById(id).value='');
  const pa=document.getElementById('partialAmt');if(pa)pa.value='';
  const _pd2=document.getElementById('partialDiv'); if(_pd2) _pd2.style.display='none';
  document.getElementById('partialInfo').innerHTML='';
  setPay('cash');renderCart();
}
async function doSale(){
  let cust=document.getElementById('sCust').value.trim();
  const phn=document.getElementById('sPhn').value.trim();
  if(!cart.length){toast('أضف أصناف للفاتورة','err');return;}
  if((payMode==='credit'||payMode==='partial')&&!cust){toast('أدخل اسم العميل','err');return;}
  if(!cust)cust='عميل نقدي';
  const grandTotal=formatMoney(cart.reduce((s,i)=>s+i.total,0));
  const now=new Date();
  const dt=now.toLocaleDateString('ar-EG')+' '+now.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
  const invNum=Date.now();
  const items=[...cart];
  for(const item of cart){
    const prod=products.find(p=>p.id===item.prodId);
    if(prod){prod.qty-=item.qty;await dbPut('products',prod);}
    await dbAdd('invoices',{customer:cust,product:item.name,productId:item.prodId,
      shelf:item.shelf,qty:item.qty,unit:item.price,total:item.total,
      payment:payMode,date:dt,phone:phn,invoiceNum:invNum,grandTotal,
      allItems:items.map(x=>({name:x.name,qty:x.qty,price:x.price,total:x.total}))});
  }
  const paidNow=payMode==='partial'?(+document.getElementById('partialAmt').value||0):0;
  if(payMode==='credit'){
    let c=customers.find(x=>x.name===cust);
    if(c){c.debt=(c.debt||0)+grandTotal;await dbPut('customers',c);}
    else await dbAdd('customers',{name:cust,phone:phn||'—',debt:grandTotal,createdAt:dt});
  } else if(payMode==='partial'){
    const rem=Math.max(0,grandTotal-paidNow);
    if(rem>0){
      let c=customers.find(x=>x.name===cust);
      if(c){c.debt=(c.debt||0)+rem;await dbPut('customers',c);}
      else await dbAdd('customers',{name:cust,phone:phn||'—',debt:rem,createdAt:dt});
    }
  } else {
    // نقدي — حفظ العميل لو جديد (بدون دين)
    if(cust!=='عميل نقدي'&&!customers.find(x=>x.name===cust)){
      await dbAdd('customers',{name:cust,phone:phn||'—',debt:0,createdAt:dt});
    }
  }
  await loadAll();
  await audit('بيع',null,`${cust} — ${grandTotal} ج (${payMode})`);
  currentInvForWA={cust,phn,pay:payMode,dt,total:grandTotal,items,paidNow,invNum};
  showPrint(cust,phn,payMode,dt,grandTotal,items,paidNow);
  clearCart();renderTodaySales();updateDashboard();
  toast(`✅ تم البيع — ${grandTotal.toFixed(2)} ج`);
}


// WhatsApp Invoice

// Invoice as image

// ════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════
let showArchiveCust=false;
function toggleArchive(){showArchiveCust=!showArchiveCust;renderCusts();}
function openAddCust(){document.getElementById('cNm').value='';document.getElementById('cPh').value='';om('mAddC');}
async function saveCust(){
  const name=document.getElementById('cNm').value.trim();
  if(!name){toast('أدخل اسم العميل','err');return;}
  const phone=document.getElementById('cPh').value.trim()||'—';
  if(customers.find(c=>c.name===name)){toast('العميل موجود بالفعل','err');return;}
  await dbAdd('customers',{name,phone,debt:0,createdAt:new Date().toLocaleString('ar-EG')});
  await audit('إضافة عميل',null,name);
  await loadAll();cm('mAddC');renderCusts();toast('✅ تم إضافة العميل');
}
function renderCusts(){
  let list=[...customers];
  if(!showArchiveCust) list=list.filter(c=>(c.debt||0)>0||!c.fullyPaid);
  // ترتيب: الأحدث فوق (الأعلى ID = الأحدث)
  // ترتيب الأحدث فوق (lastUpdated أو id كـ fallback)
  list.sort((a,b)=>(b.lastUpdated||b.id||0)-(a.lastUpdated||a.id||0));
  const arcN=customers.filter(c=>c.fullyPaid&&!(c.debt>0)).length;
  document.getElementById('custTbl').innerHTML=list.length?list.map(c=>`<tr style="${c.fullyPaid&&!(c.debt>0)?'opacity:.55':''}">
    <td style="color:var(--muted);font-size:.7rem">${c.id}</td>
    <td><b style="cursor:pointer;color:var(--blue);font-size:.78rem" onclick="showCustTx('${c.name}')">${c.name}</b>${c.note?`<div style="font-size:.6rem;color:var(--muted)">${c.note}</div>`:''}</td>
    <td><span style="font-size:.72rem">${c.phone||'—'}</span>${c.phone&&c.phone!=='—'?`<br><a href="https://wa.me/${(c.phone||'').replace(/[^0-9]/g,'').replace(/^0/,'20')}" target="_blank" style="font-size:.6rem;color:#25D366">واتساب</a>`:''}
    </td>
    <td style="font-weight:700;color:${(c.debt||0)>0?'var(--red)':'var(--green)'}">${c.debt||0} ج</td>
    <td>${(c.debt||0)>0?'<span class="br-b">دين</span>':'<span class="bg-b">سليم</span>'}</td>
    <td style="font-size:.65rem;color:var(--muted)">${c.updatedAt||c.createdAt||'—'}</td>
    <td style="white-space:nowrap">
      ${(c.debt||0)>0?`<button class="btn bg bxs" onclick="openPay(${c.id})">💳</button>`:''}
      <button class="btn bgh bxs" style="margin-right:3px" onclick="openEditCust(${c.id})">✏️</button>
      ${c.fullyPaid?`<button class="btn bxs" style="background:rgba(24,200,240,.12);color:var(--blue);border:none;margin-right:3px" onclick="restoreCust(${c.id})" title="إرجاع للنشطاء">🔄</button>`:''}
    </td>
  </tr>`).join(''):`<tr><td colspan="7"><div class="empty"><div class="empty-ic">👥</div><p>لا يوجد عملاء</p></div></td></tr>`;
  const ab=document.getElementById('archBtn');
  if(ab) ab.textContent=showArchiveCust?'📂 إخفاء المسددين':`📁 المسددون (${arcN})`;
}
function openPay(id){
  const c=customers.find(x=>x.id===id);if(!c)return;
  document.getElementById('payId').value=id;
  document.getElementById('payAmt').value='';
  document.getElementById('payDebtInfo').innerHTML=`<b>${c.name}</b> — الدين: <b style="color:var(--red)">${c.debt||0} ج</b>`;
  om('mPay');
}
async function doPay(){
  const id=+document.getElementById('payId').value;
  const amt=+document.getElementById('payAmt').value||0;
  if(amt<=0){toast('أدخل مبلغاً','err');return;}
  const c=customers.find(x=>x.id===id);if(!c)return;
  const before=c.debt||0;
  c.debt=Math.max(0,(c.debt||0)-amt);
  c.updatedAt=new Date().toLocaleString('ar-EG');
  c.lastUpdated=Date.now();
  if(c.debt<=0){c.fullyPaid=true;c.paidDate=new Date().toLocaleDateString('ar-EG');}
  await dbPut('customers',c);
  await dbAdd('invoices',{customer:c.name,product:'سداد دين',qty:1,total:amt,
    payment:'cash',date:c.updatedAt,grandTotal:amt,invoiceNum:Date.now()});
  await audit('سداد دين',`دين قبل: ${before} ج`,`دفع: ${amt} ج | متبقي: ${c.debt} ج`);
  await loadAll();cm('mPay');renderCusts();
  toast(`✅ سداد ${amt} ج${c.debt<=0?' — مسدد بالكامل ✅':''}`);
}
function openEditCust(id){
  const c=customers.find(x=>x.id===id);if(!c)return;
  document.getElementById('ecId').value=c.id;
  document.getElementById('ecNm').value=c.name;
  document.getElementById('ecPh').value=c.phone||'';
  document.getElementById('ecDebt').value=c.debt||0;
  document.getElementById('ecNote').value=c.note||'';
  document.getElementById('custLastUpdate').textContent=c.updatedAt?`آخر تعديل: ${c.updatedAt}`:'';
  om('mEditCust');
}
async function saveEditCust(){
  const id=+document.getElementById('ecId').value;
  const c=customers.find(x=>x.id===id);if(!c)return;
  const before={...c};
  c.name=document.getElementById('ecNm').value.trim();
  c.phone=document.getElementById('ecPh').value.trim()||'—';
  c.debt=+document.getElementById('ecDebt').value||0;
  c.note=document.getElementById('ecNote').value.trim();
  c.updatedAt=new Date().toLocaleString('ar-EG');
  if(c.debt>0)c.fullyPaid=false;
  await dbPut('customers',c);
  await audit('تعديل عميل',before,{...c});
  await loadAll();cm('mEditCust');renderCusts();toast('✅ تم تحديث العميل');
}
function showCustTx(name){
  const c=customers.find(x=>x.name===name);
  const txs=invoices.filter(i=>i.customer===name).sort((a,b)=>(b.id||0)-(a.id||0));
  const total=txs.filter(i=>i.product!=='سداد دين'&&!i.archived).reduce((s,i)=>s+(i.grandTotal||i.total||0),0);
  const paid=txs.filter(i=>i.product==='سداد دين').reduce((s,i)=>s+i.total,0);
  document.getElementById('txName').textContent='معاملات: '+name;
  document.getElementById('txSumm').textContent=`إجمالي: ${total} ج | مدفوع: ${paid} ج | رصيد: ${c?.debt||0} ج`;
  const grouped={};
  txs.forEach(i=>{const k=i.invoiceNum||i.id;if(!grouped[k])grouped[k]={date:i.date,payment:i.payment,total:i.grandTotal||i.total,items:[],product:i.product,invNum:k};grouped[k].items.push(i.product);});
  document.getElementById('txList').innerHTML=Object.values(grouped).map(g=>`<div style="background:var(--s2);border-radius:var(--rs);padding:9px;margin-bottom:7px;border:1px solid var(--brd)">
    <div style="display:flex;justify-content:space-between;margin-bottom:3px">
      <span style="font-size:.68rem;color:var(--muted)">${g.date}</span>
      <b style="color:${g.product==='سداد دين'?'var(--blue)':'var(--green)'};font-size:.8rem">${g.total} ج</b>
    </div>
    <div style="font-size:.74rem">${g.product==='سداد دين'?'💳 سداد دين':g.items.slice(0,3).join('، ')+(g.items.length>3?'...':'')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:5px">
      <span class="${g.payment==='cash'?'bg-b':g.payment==='partial'?'bb-b':'br-b'}" style="font-size:.6rem">${g.payment==='cash'?'نقدي':g.payment==='partial'?'جزئي':'آجل'}</span>
      ${g.product!=='سداد دين'?`<button class="btn bgh bxs" onclick="reprintInv(${g.invNum});cm('mCustTx')">🖨️</button>`:''}
    </div>
  </div>`).join('')||'<div class="empty"><p>لا توجد معاملات</p></div>';
  document.getElementById('txSumm').__custName=name;
  om('mCustTx');
}
function payFromTx(){const n=document.getElementById('txName').textContent.replace('معاملات: ','');const c=customers.find(x=>x.name===n);if(!c)return;cm('mCustTx');openPay(c.id);}
function editFromTx(){const n=document.getElementById('txName').textContent.replace('معاملات: ','');const c=customers.find(x=>x.name===n);if(!c)return;cm('mCustTx');openEditCust(c.id);}

// ════════════════════════════════════════════
// INVOICES (عميل واحد)
// ════════════════════════════════════════════

// ════════════════════════════════════════════
// KEY SERVICES
// ════════════════════════════════════════════
let kPay='cash',krPay='cash',batPay='cash';
function showKeySale(){cm('mKey');om('mKeySale');}
function showKeyRepair(){cm('mKey');om('mKeyRepair');}
function setKPay(m){kPay=m;document.getElementById('kPayBtn').className=m==='cash'?'btn bg':'btn bgh';document.getElementById('kCreditBtn').className=m==='credit'?'btn bg':'btn bgh';['kPayBtn','kCreditBtn'].forEach(id=>document.getElementById(id).style.flex='1');}
function setKrPay(m){krPay=m;document.getElementById('krPayBtn').className=m==='cash'?'btn bg':'btn bgh';document.getElementById('krCreditBtn').className=m==='credit'?'btn bg':'btn bgh';['krPayBtn','krCreditBtn'].forEach(id=>document.getElementById(id).style.flex='1');}
function setBatPay(m){batPay=m;document.getElementById('batPayBtn').className=m==='cash'?'btn bg':'btn bgh';document.getElementById('batCreditBtn').className=m==='credit'?'btn bg':'btn bgh';['batPayBtn','batCreditBtn'].forEach(id=>document.getElementById(id).style.flex='1');}

async function doKeySale(){
  const price=+document.getElementById('ksPrice').value||0;
  if(price<=0){toast('أدخل السعر','err');return;}
  const cust=document.getElementById('ksCust').value.trim()||'عميل نسخ مفتاح';
  const type=document.getElementById('ksType').value;
  const dt=new Date().toLocaleDateString('ar-EG')+' '+new Date().toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
  await dbAdd('invoices',{customer:cust,product:'نسخ مفتاح - '+type,qty:1,unit:price,total:price,payment:kPay,date:dt,grandTotal:price,invoiceNum:Date.now(),category:'key',allItems:[{name:'نسخ مفتاح - '+type,qty:1,price,total:price}]});
  if(kPay==='credit'){let c=customers.find(x=>x.name===cust);if(c){c.debt=(c.debt||0)+price;await dbPut('customers',c);}else await dbAdd('customers',{name:cust,phone:'—',debt:price});}
  await loadAll();cm('mKeySale');await audit('نسخ مفتاح',null,`${type} — ${price} ج`);
  toast(`✅ نسخ مفتاح — ${price} ج`);updateDashboard();
}
async function doKeyRepair(){
  const price=+document.getElementById('krPrice').value||0;
  if(price<=0){toast('أدخل السعر','err');return;}
  const cust=document.getElementById('krCust').value.trim()||'عميل تصليح';
  const desc=document.getElementById('krDesc').value.trim()||'تصليح كالون';
  const dt=new Date().toLocaleDateString('ar-EG')+' '+new Date().toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
  await dbAdd('invoices',{customer:cust,product:'تصليح - '+desc,qty:1,unit:price,total:price,payment:krPay,date:dt,grandTotal:price,invoiceNum:Date.now(),category:'key',allItems:[{name:'تصليح - '+desc,qty:1,price,total:price}]});
  if(krPay==='credit'){let c=customers.find(x=>x.name===cust);if(c){c.debt=(c.debt||0)+price;await dbPut('customers',c);}else await dbAdd('customers',{name:cust,phone:'—',debt:price});}
  await loadAll();cm('mKeyRepair');await audit('تصليح',null,`${desc} — ${price} ج`);
  toast(`✅ تصليح — ${price} ج`);updateDashboard();
}
async function doBatterySale(){
  const price=+document.getElementById('batPrice').value||0;
  if(price<=0){toast('أدخل السعر','err');return;}
  const cust=document.getElementById('batCust').value.trim()||'عميل شحن بطارية';
  const type=document.getElementById('batType').value;
  const warranty=document.getElementById('batWarranty').value;
  const dt=new Date().toLocaleDateString('ar-EG')+' '+new Date().toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
  await dbAdd('invoices',{customer:cust,product:`${type} — ${warranty}`,qty:1,unit:price,total:price,payment:batPay,date:dt,grandTotal:price,invoiceNum:Date.now(),category:'battery',allItems:[{name:type,qty:1,price,total:price}]});
  if(batPay==='credit'){let c=customers.find(x=>x.name===cust);if(c){c.debt=(c.debt||0)+price;await dbPut('customers',c);}else await dbAdd('customers',{name:cust,phone:'—',debt:price});}
  await loadAll();cm('mBattery');await audit('شحن بطارية',null,`${type} — ${warranty} — ${price} ج`);
  toast(`✅ ${type} — ${warranty} — ${price} ج`);updateDashboard();
}

// ════════════════════════════════════════════
// SHORTAGES (النواقص)
// ════════════════════════════════════════════
function saveShortages(){
  const txt=document.getElementById('shortagesTxt').value;
  localStorage.setItem('shortages',txt);
  toast('✅ تم حفظ قائمة النواقص');
}

// ════════════════════════════════════════════
// AUDIT LOG
// ════════════════════════════════════════════
function renderAuditLog(){
  const sorted=[...auditLog].sort((a,b)=>b.ts-a.ts);
  document.getElementById('auditList').innerHTML=sorted.length?sorted.map(a=>`<div class="audit-row">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <b style="font-size:.76rem">${a.action}</b><span class="atime">${a.time}</span>
    </div>
    ${a.before?`<div class="abefore">قبل: ${a.before.length>80?a.before.substring(0,80)+'...':a.before}</div>`:''}
    ${a.after?`<div class="aafter">بعد: ${a.after.length>80?a.after.substring(0,80)+'...':a.after}</div>`:''}
  </div>`).join(''):'<div class="empty"><p>لا يوجد سجل بعد</p></div>';
}
function renderAuditPreview(){
  const sorted=[...auditLog].sort((a,b)=>b.ts-a.ts).slice(0,10);
  document.getElementById('auditPreview').innerHTML=sorted.length?sorted.map(a=>`<div style="padding:6px 0;border-bottom:1px solid var(--brd);font-size:.74rem"><b>${a.action}</b> <span style="font-size:.64rem;color:var(--muted)">${a.time}</span></div>`).join(''):'<div style="color:var(--muted);font-size:.76rem;padding:10px">لا يوجد سجل</div>';
}
async function clearAuditLog(){
  if(!confirm('مسح سجل التعديلات كاملاً؟')) return;
  const all=await dbAll('auditLog');
  for(const r of all) await dbDel('auditLog',r.id);
  await loadAll();renderAuditLog();
  toast('✅ تم مسح السجل');
}

// ════════════════════════════════════════════
// BACKUP
// ════════════════════════════════════════════

// ════════════════════════════════════════════
// DEBT ALERT
// ════════════════════════════════════════════

// ════════════════════════════════════════════
// FONT SIZE
// ════════════════════════════════════════════
let fontSize=14;

// ════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════
document.addEventListener('click',e=>{if(!e.target.closest('#sCust')&&!e.target.closest('#custSug'))document.getElementById('custSug').style.display='none';});
document.querySelectorAll('.ov').forEach(ov=>{ov.addEventListener('click',e=>{if(e.target===ov)ov.classList.remove('open');});});

function tick(){document.getElementById('hTime').textContent=new Date().toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});}
setInterval(tick,1000);tick();
function chkNet(){
  const offline=!navigator.onLine;
  const badge=document.getElementById('offBadge');
  if(badge){badge.classList.toggle('on',offline);badge.textContent=offline?'📵 أوف لاين':'';badge.title=offline?'لا يوجد إنترنت — التطبيق يعمل محلياً':'متصل';}
  const fbEl=document.getElementById('fbStatus');
  if(fbEl&&offline){fbEl.textContent='💾 محلي';fbEl.style.color='var(--muted)';}
}
window.addEventListener('online',chkNet);window.addEventListener('offline',chkNet);chkNet();


// Service Worker Inline — Offline دايماً
function registerSWInline(){
  if(!('serviceWorker' in navigator)) return;
  const swCode=`const CACHE='toktok-v4';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.add('/').catch(()=>{})).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(cached=>{const net=fetch(e.request.clone()).then(res=>{if(res&&res.ok){const r=res.clone();caches.open(CACHE).then(c=>c.put(e.request,r));}return res;}).catch(()=>null);return cached||net||new Response('Offline',{status:503});})  );});`;
  try{const b=new Blob([swCode],{type:'application/javascript'});navigator.serviceWorker.register(URL.createObjectURL(b)).then(()=>console.log('✅ SW OK')).catch(e=>{navigator.serviceWorker.register('./sw.js').catch(()=>{});});}
  catch(e){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
}
registerSWInline();
let deferredPrompt;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();deferredPrompt=e;
  const _ib=document.getElementById('installBanner'); if(_ib) _ib.style.display='flex';
  const _ihb=document.getElementById('installHeaderBtn'); if(_ihb) _ihb.style.display='inline-block';
});
function triggerInstall(){
  if(deferredPrompt){
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(r=>{
      const banner=document.getElementById('installBanner');
      if(banner) banner.style.display='none';
      if(r.outcome==='accepted'){
        toast('🎉 تم تثبيت التطبيق بنجاح!');
        const btn=document.getElementById('installHeaderBtn');
        if(btn){btn.textContent='✅ مثبّت';btn.disabled=true;btn.style.background='#334155';}
      }
      deferredPrompt=null;
    });
  } else {
    const ua=navigator.userAgent;
    let msg='';
    if(/iPhone|iPad|iPod/.test(ua)){
      msg='على iPhone: اضغط زر المشاركة ثم اختر "إضافة إلى الشاشة الرئيسية"';
    } else if(/Android/.test(ua)){
      msg='على Android: افتح قائمة المتصفح ثم اختر "إضافة إلى الشاشة الرئيسية"';
    } else {
      msg='على الكمبيوتر: اضغط أيقونة التثبيت في شريط العنوان أو من قائمة المتصفح';
    }
    alert(msg);
  }
}
document.getElementById('installBtn')?.addEventListener('click',triggerInstall);
const _ihb=document.getElementById('installHeaderBtn'); if(_ihb) _ihb.style.display='inline-block';

const savedFs=localStorage.getItem('fs');if(savedFs){fontSize=+savedFs;changeFontSize(0);}
document.getElementById('gpVal').value=globalProfit;
document.getElementById('gpLabel').textContent=(globalProfit>=0?'+':'')+globalProfit+'%';

// تحميل النواقص
const savedShortages=localStorage.getItem('shortages');
if(savedShortages) document.getElementById('shortagesTxt').value=savedShortages;

(async()=>{
  await initDB();
  await loadAll();
  refreshShelfSel('invShelf');
  refreshShelfSel('sShelf');
  showSection('home');
  renderDailyReport();
  renderTodaySales();
  // تنبيه الديون عند الفتح
  setTimeout(showDebtAlert,1500);
})();

// ════════════════════════════════════════════
// PROFIT CALCULATION
// ════════════════════════════════════════════
function calcProfits(){
  const today=new Date().toLocaleDateString('ar-EG');
  const thisMonth=today.substring(0,today.lastIndexOf('/'));  // مم/سسسس

  // ربح = (سعر البيع - سعر الشراء) × الكمية
  let dayProfit=0, monthProfit=0;
  let debtBat=0, debtTok=0;

  // حساب الأرباح من الفواتير
  invoices.filter(i=>!i.archived&&i.product!=='سداد دين').forEach(i=>{
    const prod=products.find(p=>p.id===i.productId);
    const buyP=prod?.buyPrice||0;
    const profit=(i.unit-buyP)*i.qty;
    if(profit>0){
      if((i.date||'').startsWith(today)) dayProfit+=profit;
      if((i.date||'').includes(thisMonth.split('/')[0])) monthProfit+=profit;
    }
  });

  // ديون بالنوع
  invoices.filter(i=>!i.archived&&i.payment!=='cash'&&i.product!=='سداد دين').forEach(i=>{
    const cat = i.category || getCat({name:i.product||'',category:i.category});
    if(cat==='battery') debtBat+=(i.total||0);
    else if(cat==='toktok') debtTok+=(i.total||0);
  });
  // خصم السداد
  invoices.filter(i=>i.product==='سداد دين').forEach(i=>{
    debtBat=Math.max(0,debtBat-(i.total||0)/2);
    debtTok=Math.max(0,debtTok-(i.total||0)/2);
  });

  const sp_d=document.getElementById('sb-profit-day');
  const sp_m=document.getElementById('sb-profit-month');
  const sd_b=document.getElementById('sb-debt-bat');
  const sd_t=document.getElementById('sb-debt-tok');
  if(sp_d) sp_d.textContent=dayProfit.toFixed(0)+' ج';
  if(sp_m) sp_m.textContent=monthProfit.toFixed(0)+' ج';
  if(sd_b) sd_b.textContent=debtBat.toFixed(0)+' ج';
  if(sd_t) sd_t.textContent=debtTok.toFixed(0)+' ج';
  // تحديث Dashboard أيضاً
  const dbpd=document.getElementById('db-profit-day');
  const dbpm=document.getElementById('db-profit-month');
  const dbdb=document.getElementById('db-debt-bat');
  const dbdt=document.getElementById('db-debt-tok');
  if(dbpd) dbpd.textContent=dayProfit.toFixed(0)+' ج';
  if(dbpm) dbpm.textContent=monthProfit.toFixed(0)+' ج';
  if(dbdb) dbdb.textContent=debtBat.toFixed(0)+' ج';
  if(dbdt) dbdt.textContent=debtTok.toFixed(0)+' ج';
  // تحديث quickStrip أيضاً
  updateQuickStrip();
}


// ════════════════════════════════════════════════════
// SUPPLIERS — الموردين (كامل ومصحح)
// ════════════════════════════════════════════════════
function openAddSupplier(){
  ['supNm','supPh','supType','supAddr','supNote'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const bal=document.getElementById('supBal'); if(bal) bal.value='0';
  om('mAddSupplier');
}

async function saveSupplier(){
  const nmEl=document.getElementById('supNm');
  const name=(nmEl?.value||'').trim();
  if(!name){toast('أدخل اسم المورد','err');return;}
  if(suppliers.find(s=>s.name===name&&!s.archived)){toast('المورد موجود بالفعل','err');return;}
  const rec={
    name,
    phone:(document.getElementById('supPh')?.value||'').trim()||'—',
    type:(document.getElementById('supType')?.value||'').trim()||'—',
    address:(document.getElementById('supAddr')?.value||'').trim()||'—',
    balance:+document.getElementById('supBal')?.value||0,
    notes:(document.getElementById('supNote')?.value||'').trim(),
    createdAt:new Date().toLocaleString('ar-EG')
  };
  await dbAdd('suppliers',rec);
  await audit('إضافة مورد',null,name);
  await loadAll(); cm('mAddSupplier'); renderSuppliers();
  // clear inputs
  ['supNm','supPh','supType','supAddr','supNote'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const sb=document.getElementById('supBal'); if(sb) sb.value='0';
  toast('✅ تم إضافة المورد');
}

function openEditSupplier(id){
  const s=suppliers.find(x=>x.id===id); if(!s) return;
  document.getElementById('esId').value=s.id;
  document.getElementById('esNm').value=s.name||'';
  document.getElementById('esPh').value=s.phone||'';
  document.getElementById('esType').value=s.type||'';
  document.getElementById('esAddr').value=s.address||'';
  document.getElementById('esBal').value=s.balance||0;
  document.getElementById('esNote').value=s.notes||'';
  const lu=document.getElementById('supLastUpdate');
  if(lu) lu.textContent=s.updatedAt?`آخر تعديل: ${s.updatedAt}`:'';
  om('mEditSupplier');
}

async function updSupplier(){
  const id=+document.getElementById('esId').value;
  const s=suppliers.find(x=>x.id===id); if(!s) return;
  const before={...s};
  s.name=(document.getElementById('esNm')?.value||'').trim();
  s.phone=(document.getElementById('esPh')?.value||'').trim()||'—';
  s.type=(document.getElementById('esType')?.value||'').trim()||'—';
  s.address=(document.getElementById('esAddr')?.value||'').trim()||'—';
  s.balance=+document.getElementById('esBal')?.value||0;
  s.notes=(document.getElementById('esNote')?.value||'').trim();
  s.updatedAt=new Date().toLocaleString('ar-EG');
  await dbPut('suppliers',s);
  await audit('تعديل مورد',`${before.name} رصيد:${before.balance}`,`${s.name} رصيد:${s.balance}`);
  await loadAll(); cm('mEditSupplier'); renderSuppliers();
  toast('✅ تم تحديث المورد');
}

async function archiveSupplier(id){
  const s=suppliers.find(x=>x.id===id); if(!s) return;
  if(!confirm(`أرشفة "${s.name}"?`)) return;
  s.archived=true; s.archivedAt=new Date().toLocaleString('ar-EG');
  await dbPut('suppliers',s);
  await audit('أرشفة مورد',s.name,'مؤرشف');
  await loadAll(); cm('mEditSupplier'); renderSuppliers();
  toast(`🗄️ تم أرشفة "${s.name}"`);
}

function renderSuppliers(){
  const q=(document.getElementById('supQ')?.value||'').toLowerCase();
  const list=suppliers.filter(s=>{
    if(s.archived) return false;
    if(!q) return true;
    return s.name.toLowerCase().includes(q)||(s.type||'').toLowerCase().includes(q)||(s.phone||'').includes(q);
  });
  const tbl=document.getElementById('suppliersTbl');
  if(!tbl) return;
  tbl.innerHTML=list.length?list.map(s=>`<tr>
    <td><b style="cursor:pointer;color:var(--blue);font-size:.78rem" onclick="openEditSupplier(${s.id})">${s.name}</b>${s.notes?`<div style="font-size:.6rem;color:var(--muted)">${(s.notes||'').substring(0,40)}</div>`:''}</td>
    <td style="font-size:.72rem">${s.phone||'—'}${s.phone&&s.phone!=='—'?`<br><a href="https://wa.me/${(s.phone||'').replace(/[^0-9]/g,'').replace(/^0/,'20')}" target="_blank" style="font-size:.6rem;color:#25D366">واتساب</a>`:''}</td>
    <td style="font-size:.74rem">${s.type||'—'}</td>
    <td style="font-weight:700;color:${(s.balance||0)>0?'var(--red)':'var(--green)'}">${s.balance||0} ج</td>
    <td><span class="${(s.balance||0)>0?'br-b':'bg-b'}">${(s.balance||0)>0?'مستحق':'صفر'}</span></td>
    <td style="font-size:.65rem;color:var(--muted)">${s.updatedAt||s.createdAt||'—'}</td>
    <td style="white-space:nowrap">
      <button class="btn bgh bxs" onclick="openEditSupplier(${s.id})">✏️</button>
      <button class="btn bxs" style="background:var(--rdim);color:var(--red);border:none;margin-right:3px" onclick="archiveSupplier(${s.id})">🗄️</button>
    </td>
  </tr>`).join(''):`<tr><td colspan="7"><div class="empty"><div class="empty-ic">🏭</div><p>لا يوجد موردون بعد — اضغط "＋ مورد" لإضافة</p></div></td></tr>`;
}

// ════════════════════════════════════════════════════
// SETTINGS — الإعدادات
// ════════════════════════════════════════════════════


// ════════════════════════════════════════════════════
// SHORTAGES TABLE (النواقص جدول)
// ════════════════════════════════════════════════════
let shortagesData = JSON.parse(localStorage.getItem('shortagesTable')||'[]');

function renderShortagesTable(){
  const tbl=document.getElementById('shortagesTbl2');
  if(!tbl) return;
  tbl.innerHTML=shortagesData.length?shortagesData.map((row,i)=>`<tr>
    <td><input value="${row.name||''}" onchange="shortagesData[${i}].name=this.value;saveShortagesTable()" style="background:var(--s2);border:1px solid var(--brd2);border-radius:5px;padding:5px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:.78rem;width:100%"></td>
    <td><input value="${row.qty||''}" onchange="shortagesData[${i}].qty=this.value;saveShortagesTable()" style="background:var(--s2);border:1px solid var(--brd2);border-radius:5px;padding:5px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:.78rem;width:70px"></td>
    <td><button class="btn br bxs" onclick="shortagesData.splice(${i},1);saveShortagesTable();renderShortagesTable()">✕</button></td>
  </tr>`).join(''):`<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:12px;font-size:.76rem">لا توجد نواقص — اضغط ＋ لإضافة</td></tr>`;
}
function addShortageRow(){
  shortagesData.push({name:'',qty:''});
  saveShortagesTable(); renderShortagesTable();
  // scroll للآخر
  const tbl=document.getElementById('shortagesTbl2');
  if(tbl) tbl.lastElementChild?.scrollIntoView({behavior:'smooth'});
}


// ════════════════════════════════════════════════════
// LIVE SEARCH — بحث مباشر
// ════════════════════════════════════════════════════

function filterCustomers(){
  const q=(document.getElementById('custLiveQ')?.value||'').toLowerCase().trim();
  const rows=document.querySelectorAll('#custTbl tr');
  rows.forEach(row=>{
    if(!q){ row.style.display=''; return; }
    const txt=(row.textContent||'').toLowerCase();
    // بحث في الاسم + الموبايل + الـ ID
    row.style.display=txt.includes(q)?'':'none';
  });
}


// ════════════════════════════════════════════
// updateDashboard — يُستدعى بعد كل عملية
// ════════════════════════════════════════════
function updateDashboard(){
  renderHome();
  renderDailyReport();
  calcProfits();
  updateQuickStrip();
}


// ════════════════════════════════════════════
// AUTO BACKUP — كل 5 دقائق
// ════════════════════════════════════════════
const DEBUG = false;

// ══ Rotation Backup — عرض وإستعادة النسخ ══


// تشغيل auto backup كل 5 دقائق
setInterval(autoBackupNow, 300000);


// ════════════════════════════════════════════
// تنبيه الديون المتأخرة (15+ يوم)
// يعمل أون لاين وأوف لاين
// ════════════════════════════════════════════


// ════════════════════════════════════════════
// استرجاع عميل من الأرشيف
// ════════════════════════════════════════════
async function restoreCust(id){
  const c=customers.find(x=>x.id===id); if(!c) return;
  if(!confirm(`استرجاع "${c.name}" من الأرشيف؟`)) return;
  c.fullyPaid=false;
  c.paidDate=null;
  c.restoredAt=new Date().toLocaleString('ar-EG');
  await dbPut('customers',c);
  await audit('استرجاع عميل',`${c.name} مؤرشف`,`${c.name} نشط`);
  await loadAll(); renderCusts();
  toast(`✅ تم استرجاع "${c.name}"`);
}


function updateQuickStrip(){
  let debtBat=0,debtTok=0;
  customers.forEach(c=>{
    if(!(c.debt>0)) return;
    const custInvs=invoices.filter(i=>i.customer===c.name&&i.payment!=='cash'&&i.product!=='سداد دين'&&!i.archived);
    const batT=custInvs.filter(i=>getCat({name:i.product||'',category:i.category})==='battery').reduce((s,i)=>s+(i.total||0),0);
    const tokT=custInvs.filter(i=>getCat({name:i.product||'',category:i.category})==='toktok').reduce((s,i)=>s+(i.total||0),0);
    if(batT>=tokT) debtBat+=c.debt; else debtTok+=c.debt;
  });
  const qdb=document.getElementById('qs-debt-bat');
  const qdt=document.getElementById('qs-debt-tok');
  if(qdb) qdb.textContent=debtBat.toFixed(0)+' ج';
  if(qdt) qdt.textContent=debtTok.toFixed(0)+' ج';
}


// ════════════════════════════════════════════
// ربح الأقسام — دوال آمنة (لا تكسر أي شيء)
// ════════════════════════════════════════════
const GP_SEC_KEY = 'gpSections_v1';
let gpSections = (()=>{try{return JSON.parse(localStorage.getItem(GP_SEC_KEY)||'{}');}catch(e){return {};}})();

function changeGPsec(sec, delta){
  try{
    const map = {bat:'gpBat',tok:'gpTok',key:'gpKey'};
    const id = map[sec]; if(!id) return;
    const el = document.getElementById(id);
    const cur = el ? +el.textContent||+el.value||0 : (gpSections[sec]||0);
    const v = Math.max(-50, Math.min(200, cur + delta));
    if(el){ if(el.tagName==='INPUT') el.value=v; else el.textContent=v; }
    gpSections[sec] = v;
    localStorage.setItem(GP_SEC_KEY, JSON.stringify(gpSections));
    const lblMap = {bat:'gpBatLbl',tok:'gpTokLbl',key:'gpKeyLbl'};
    const lbl = document.getElementById(lblMap[sec]);
    if(lbl) lbl.textContent = (v>=0?'+':'')+v+'%';
  }catch(e){ console.warn('changeGPsec:',e.message); }
}

async function applyGPsec(catName){
  try{
    const secMap = {battery:'bat',toktok:'tok',key:'key'};
    const sec = secMap[catName]||'bat';
    const gp = gpSections[sec]||0;
    const targets = products.filter(p=>!p.archived && getCat(p)===catName);
    if(!targets.length){ toast('لا توجد منتجات في هذا القسم','err'); return; }
    if(!confirm(`تطبيق ربح ${gp>=0?'+':''}${gp}% على ${targets.length} منتج؟`)) return;
    for(const p of targets){
      if(p.buyPrice>0){
        const pp = p.productProfit||20;
        p.sellPrice = Math.round(p.buyPrice*(1+(pp+gp)/100)*100)/100;
        await dbPut('products',p);
      }
    }
    await loadAll(); renderInv();
    await audit('ربح قسم '+catName, null, `${gp>=0?'+':''}${gp}% على ${targets.length} منتج`);
    toast(`✅ ربح ${gp>=0?'+':''}${gp}% على ${targets.length} منتج`);
  }catch(e){ console.warn('applyGPsec:',e.message); toast('❌ خطأ: '+e.message,'err'); }
}


// ════════════════════════════════════════════
// بحث العملاء (اسم + موبايل)
// ════════════════════════════════════════════
function searchCustomers(value){
  const q=(value||'').toLowerCase().trim();
  const rows=document.querySelectorAll('#custTbl tr');
  rows.forEach(row=>{
    if(!q){ row.style.display=''; return; }
    const txt=(row.textContent||'').toLowerCase();
    row.style.display=txt.includes(q)?'':'none';
  });
}


// ════════════════════════════════════════════
// safeSync — Firebase sync آمن (اختياري)
// ════════════════════════════════════════════
function safeSync(data){
  try{
    if(navigator.onLine && fbEnabled && fbDB){
      fbDB.collection('pos').doc('data').set(data||{},{merge:true}).catch(e=>console.warn('safeSync:',e.message));
    }
  }catch(e){ console.warn('safeSync err:',e.message); }
}


// ════════════════════════════════════════════
// showProfitDetails — تفاصيل الأرباح بالأقسام
// ════════════════════════════════════════════

function showProfitDetails(){
  try{
    let batProfit=0,tokProfit=0,keyProfit=0,total=0;
    invoices.filter(i=>!i.archived&&i.product!=='سداد دين').forEach(i=>{
      const prod=products.find(p=>p.id===i.productId);
      const buyP=prod?.buyPrice||i.buyPrice||0;
      const profit=(i.unit-buyP)*(i.qty||1);
      if(profit<=0) return;
      const cat=getCat({name:i.product||'',category:i.category});
      if(cat==='battery') batProfit+=profit;
      else if(cat==='key') keyProfit+=profit;
      else tokProfit+=profit;
      total+=profit;
    });
    const pb=document.getElementById('pb-bat'); if(pb) pb.textContent=batProfit.toFixed(0)+' ج';
    const pt=document.getElementById('pb-tok'); if(pt) pt.textContent=tokProfit.toFixed(0)+' ج';
    const pk=document.getElementById('pb-key'); if(pk) pk.textContent=keyProfit.toFixed(0)+' ج';
    const ptt=document.getElementById('pb-total'); if(ptt) ptt.textContent=total.toFixed(0)+' ج';
    om('mProfitDetails');
  }catch(e){ console.warn('showProfitDetails:',e.message); }
}


// ════════════════════════════════════════════
// searchAll — بحث عام (اسم + موبايل + ID)
// ════════════════════════════════════════════
function searchAll(value, data){
  const v=(value||'').toLowerCase().trim();
  if(!v) return data;
  return data.filter(item=>
    (item.name&&item.name.toLowerCase().includes(v))||
    (item.phone&&item.phone.includes(v))||
    (item.id&&item.id.toString().includes(v))
  );
}

// ════════════════════════════════════════════
// backupData — حفظ نسخة احتياطية فورية
// ════════════════════════════════════════════

// ════════════════════════════════════════════
// safeRun — تشغيل آمن مع Crash Protection
// ════════════════════════════════════════════
function safeRun(fn){
  try{ fn(); }
  catch(e){
    console.error('safeRun error:',e);
    if(typeof toast==='function') toast('❌ حدث خطأ غير متوقع','err');
  }
}

// ════════════════════════════════════════════
// confirmAction — تأكيد العمليات الحساسة
// ════════════════════════════════════════════
function confirmAction(msg, callback){
  const text = typeof msg==='function' ? '⚠️ هل أنت متأكد؟' : (msg||'⚠️ هل أنت متأكد؟');
  const fn   = typeof msg==='function' ? msg : callback;
  if(confirm(text) && typeof fn==='function') fn();
}

console.log('✅ Production FINAL 100% Ready');


// ════════════════════════════════════════════
// DOM Safety — منع null .style errors
// ════════════════════════════════════════════


// ════════════════════════════════════════════
// bindSearch — ربط البحث بالصفحات
// ════════════════════════════════════════════
function bindSearch(inputId, renderFn){
  const inp = document.getElementById(inputId);
  if(!inp) return;
  // منع تكرار الـ listener
  if(inp._searchBound) return;
  inp._searchBound = true;
  inp.addEventListener('input', function(){
    const q = this.value.toLowerCase().trim();
    renderFn(q);
  });
}
// استخدام bindSearch مع الدوال الحالية
function initSearchBindings(){
  // العملاء — custLiveQ
  bindSearch('custLiveQ', q=>{
    const rows=document.querySelectorAll('#custTbl tr');
    rows.forEach(r=>{ r.style.display=(!q||(r.textContent||'').toLowerCase().includes(q))?'':'none'; });
  });
  // مبيعات اليوم — todQ
  bindSearch('todQ', q=>{
    const rows=document.querySelectorAll('#todTbl tr');
    rows.forEach(r=>{ r.style.display=(!q||(r.textContent||'').toLowerCase().includes(q))?'':'none'; });
  });
  // الفواتير — invFQ (يعيد render مع الفلتر)
  bindSearch('invFQ', q=>{
    if(typeof renderInvoices==='function') renderInvoices();
  });
}


// ════════════════════════════════════════════
// loadFromFirebase — تحميل من Firebase عند البداية
// ════════════════════════════════════════════
function loadFromFirebase(){
  try{
    if(!navigator.onLine||!fbEnabled||!fbDB) return;
    fbDB.collection('pos').doc('data').get().then(doc=>{
      if(doc&&doc.exists){
        const d=doc.data();
        if(d&&d.lastSync) console.log('Firebase data from:',d.lastSync);
      }
    }).catch(e=>console.warn('loadFromFirebase:',e.message));
  }catch(e){ console.warn('loadFromFirebase err:',e.message); }
}


// إزالة أي عناصر دين مكررة خارج Dashboard
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('#batteryDebt, #toktokDebt').forEach(el=>{
    if(el.closest('.sidebar')||el.closest('.sidebar-debts')) el.parentElement?.remove();
  });
});


// ════════════════════════════════════════════
// formatMoney — تقريب الأرقام (بدون كسور)
// ════════════════════════════════════════════
function formatMoney(num){
  const n = +num||0;
  return Math.round(n * 100) / 100; // أقصاه منزلتان عشريتان
}
function fmtDisplay(num){
  const n = formatMoney(num);
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}


// ════════════════════════════════════════════
// mergeProducts — دمج ذكي بدون تكرار
// ════════════════════════════════════════════
async function mergeProducts(newProds){
  let merged=0, added=0;
  for(const np of newProds){
    if(!np.name) continue;
    // منع التكرار: بحث بالاسم + الكود
    const ex=products.find(p=>{
      if(p.archived) return false;
      const sameName=p.name.trim()===np.name.trim();
      const sameCode=np.code?(p.code||'').trim()===(np.code||'').trim():true;
      return sameName && sameCode;
    });
    if(ex){
      // خد الأحدث فقط (lastUpdated comparison)
      if((np.lastUpdated||0) > (ex.lastUpdated||0)){
        const keepId=ex.id;
        Object.assign(ex, np);
        ex.id=keepId; // نحافظ على الـ ID المحلي
        ex.updatedAt=new Date().toLocaleString('ar-EG');
        await dbPut('products',ex);
      }
      merged++;
    } else {
      const newP={...np};
      delete newP.id;
      newP.minQty=newP.minQty||3;
      newP.lastUpdated=newP.lastUpdated||Date.now();
      newP.createdAt=new Date().toLocaleString('ar-EG');
      await dbAdd('products',newP);
      added++;
    }
  }
  return {merged, added};
}


// ════════════════════════════════════════════
// resetAllData — مسح كامل + إعادة ضبط
// ════════════════════════════════════════════


// ════════════════════════════════════════════
// cleanDuplicates — تنظيف المكررات (مرة واحدة)
// ════════════════════════════════════════════

// downloadBackup — تحميل نسخة بزر واحد


// ════════════════════════════════════════════
// confirmReset — حماية العمليات الحساسة
// ════════════════════════════════════════════


// ════ Splash Screen — يختفي بعد التحميل ════
window.addEventListener('load',()=>{
  setTimeout(()=>{
    const sp=document.getElementById('splashScreen');
    if(!sp) return;
    sp.style.opacity='0';
    setTimeout(()=>{sp.style.display='none';},500);
  },1800);
});


// ════════════════════════════════════════════════════
// نظام الربح الاحترافي — Auto + Override + Invoice
// ════════════════════════════════════════════════════

// حساب سعر منتج واحد (يدعم override لكل منتج)
function calcPrice(product){
  try{
    const bat=+(localStorage.getItem('profit_bat')||globalProfit||0);
    const tok=+(localStorage.getItem('profit_tok')||globalProfit||0);
    const key=+(localStorage.getItem('profit_key')||globalProfit||0);
    // Override: لو المنتج عنده ربح خاص يتجاهل الربح العام
    let pct = product.productProfit !== undefined ? +product.productProfit :
              product.category==='battery' ? bat :
              product.category==='key' ? key : tok;
    const cost = +(product.buyPrice||product.cost||0);
    if(cost <= 0) return +(product.sellPrice||product.price||0);
    return formatMoney(cost + (cost * pct / 100));
  }catch(e){ return +(product.sellPrice||product.price||0); }
}

// حساب ربح الفاتورة

// حساب إجمالي الفاتورة مع الخصم (بدون كسر الربح)

// Live Update — عند تغيير نسبة ربح قسم
function onProfitChange(){
  try{
    const bat=document.getElementById('gpBat');
    const tok=document.getElementById('gpTok');
    const key=document.getElementById('gpKey');
    if(bat) localStorage.setItem('profit_bat', bat.value||0);
    if(tok) localStorage.setItem('profit_tok', tok.value||0);
    if(key) localStorage.setItem('profit_key', key.value||0);
  }catch(e){ console.warn('onProfitChange:',e.message); }
}

// تحديث سعر منتج واحد بعد التعديل
function applyPriceToProduct(p){
  if(p.buyPrice>0){
    p.sellPrice=calcPrice(p);
    p.price=p.sellPrice;
  }
  return p;
}


// تحديث عند اكتمال التثبيت
window.addEventListener('appinstalled',()=>{
  const btn=document.getElementById('installHeaderBtn');
  if(btn){btn.textContent='✅ مثبّت';btn.disabled=true;btn.style.background='#334155';}
  const banner=document.getElementById('installBanner');
  if(banner) banner.style.display='none';
  deferredPrompt=null;
  toast('🎉 تم تثبيت التطبيق بنجاح!');
});


// ════ تغيير اسم المحل ════


// ════════════════════════════════════════════
// نظام الباركود — Barcode Scanner Support
// ════════════════════════════════════════════

// USB Barcode Scanner — listens for rapid keystrokes ending with Enter



// ════════════════════════════════════════════
// نظام تذكير الديون — يدوي + تلقائي أسبوعي
// ════════════════════════════════════════════

// رسالة تذكير واحدة

// إرسال لكل العملاء المدينين

// تذكير تلقائي كل أسبوع

// تشغيل الفحص عند البداية وكل ساعة
setTimeout(checkAutoDebtReminder, 3000);
setInterval(checkAutoDebtReminder, 60*60*1000);
