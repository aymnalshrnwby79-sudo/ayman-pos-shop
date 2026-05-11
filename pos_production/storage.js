// ════════════════════════════════════════════════
// storage.js — نظام التخزين والنسخ الاحتياطي
// أيمن الشرنوبى — نظام البيع الذهبي v5.0
// ════════════════════════════════════════════════

// IndexedDB globals (defined in app.js)
// Depends on: products, customers, invoices, suppliers, auditLog, globalProfit


// ══ initDB ══
function initDB(){
  return new Promise((res,rej)=>{
    const req=indexedDB.open('ToktokShopV3',3);
    req.onupgradeneeded=e=>{
      const d=e.target.result;
      ['products','customers','invoices','auditLog','suppliers'].forEach(s=>{
        if(!d.objectStoreNames.contains(s))
          d.createObjectStore(s,{keyPath:'id',autoIncrement:true});
      });
    };
    req.onsuccess=e=>{db=e.target.result;res();};
    req.onerror=()=>rej(req.error);
  });
}


// ══ loadAll ══
async function loadAll(){
  [products,customers,invoices,auditLog,suppliers]=await Promise.all([
    dbAll('products'),dbAll('customers'),dbAll('invoices'),dbAll('auditLog'),dbAll('suppliers')
  ]);
}


// ══ exportBackup ══
async function exportBackup(){
  const sh=(()=>{try{return JSON.parse(localStorage.getItem('shortagesTable')||'[]');}catch(e){return[];}})();
  const settings=(()=>{try{return JSON.parse(localStorage.getItem('appSettings')||'{}');}catch(e){return{};}})();
  const data={
    products,customers,invoices,auditLog,suppliers,
    missing:sh, settings, globalProfit,
    exportedAt:new Date().toISOString(), version:'3.2',
    meta:{totalProducts:products.filter(p=>!p.archived).length, totalCustomers:customers.length, totalInvoices:invoices.length}
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`toktok-backup-${new Date().toLocaleDateString('ar-EG').replace(/[/]/g,'-')}.json`;
  a.click();URL.revokeObjectURL(url);
  await audit('تصدير نسخة احتياطية',null,'تم');
  toast('✅ تم تصدير النسخة الاحتياطية');
}


// ══ importBackup ══
async function importBackup(ev){
  const file=ev.target.files[0]; if(!file) return;
  try{
    const text=await file.text();
    const data=JSON.parse(text);
    if(!data.products&&!data.customers) throw new Error('ملف غير صالح');

    // ── معاينة الأرقام قبل أي قرار ──
    const stats={
      products:(data.products||[]).length,
      customers:(data.customers||[]).length,
      invoices:(data.invoices||[]).length,
      suppliers:(data.suppliers||[]).length,
      missing:(data.missing||[]).length,
      date:data.exportedAt?new Date(data.exportedAt).toLocaleDateString('ar-EG'):'-'
    };
    const preview=
      'استيراد البيانات\n' +
      '─────────────────\n' +
      'تاريخ الملف: '+stats.date+'\n' +
      'منتجات: '+stats.products+'\n' +
      'عملاء: '+stats.customers+'\n' +
      'فواتير: '+stats.invoices+'\n' +
      'موردين: '+stats.suppliers+'\n' +
      'نواقص: '+stats.missing+'\n' +
      '─────────────────\n' +
      'حسناً = دمج (Merge) — آمن\n' +
      'إلغاء = استبدال كامل (Replace)';
    const isMerge=confirm(preview);

    // كلمة سر مطلوبة للـ Replace
    if(!isMerge){
      const pwd=prompt('كلمة مرور المدير للاستبدال الكامل:');
      const adminPwd=localStorage.getItem('adminPwd')||ADMIN_PWD;
      if(pwd!==adminPwd){toast('❌ كلمة المرور غلط!','err');return;}
    }

    // Backup قبل أي شيء
    backupBeforeImport();
    toast('⏳ جاري الاستيراد...');

    if(!isMerge){
      // Replace — مسح IndexedDB كامل
      const stores=['products','customers','invoices','suppliers'];
      for(const s of stores){
        const all=await dbAll(s);
        for(const r of all) await dbDel(s,r.id);
      }
    }

    // استيراد المنتجات (merge ذكي)
    const mr=await mergeProducts(data.products||[]);

    // استيراد العملاء (الأحدث يكسب)
    for(const c of (data.customers||[])){
      const exC=customers.find(x=>x.name===c.name);
      if(!exC){ delete c.id; await dbAdd('customers',c); }
      else if((c.lastUpdated||0)>(exC.lastUpdated||0)){
        const kId=exC.id; Object.assign(exC,c); exC.id=kId;
        await dbPut('customers',exC);
      }
    }
    // استيراد الفواتير (بدون تكرار برقم الفاتورة)
    for(const i of (data.invoices||[])){
      if(!invoices.find(x=>x.invoiceNum===i.invoiceNum&&x.customer===i.customer)){
        delete i.id; await dbAdd('invoices',i);
      }
    }
    // الموردين (الأحدث يكسب)
    if(data.suppliers){
      for(const s of data.suppliers){
        const exS=suppliers.find(x=>x.name===s.name&&!x.archived);
        if(!exS){ delete s.id; await dbAdd('suppliers',s); }
        else if((s.lastUpdated||0)>(exS.lastUpdated||0)){
          const kId=exS.id; Object.assign(exS,s); exS.id=kId;
          await dbPut('suppliers',exS);
        }
      }
    }
    // النواقص
    if(data.missing){try{localStorage.setItem('shortagesTable',JSON.stringify(data.missing));}catch(e){}}
    // الإعدادات
    if(data.settings){try{localStorage.setItem('appSettings',JSON.stringify(data.settings));}catch(e){}}

    await loadAll();
    await audit('استيراد',null,(isMerge?'merge':'replace')+': '+file.name);
    updateDashboard();
    renderHome();renderInv();renderCusts();renderInvoices();renderDailyReport();
    toast('✅ '+(isMerge?'دمج':'استبدال')+' — '+mr.added+' جديد + '+mr.merged+' تحديث');
  }catch(e){toast('❌ خطأ: '+e.message,'err');}
  ev.target.value='';
}


// ══ saveShortagesTable ══
function saveShortagesTable(){
  localStorage.setItem('shortagesTable',JSON.stringify(shortagesData));
}


// ══ renderRotationBackups ══
function renderRotationBackups(){
  const list = document.getElementById('backupRotationList');
  if(!list) return;
  const items = [];
  for(let i=1; i<=7; i++){
    const data = localStorage.getItem('auto_backup_rot_'+i);
    const time = localStorage.getItem('auto_backup_rot_'+i+'_time');
    if(data && time){
      const sizeKB = (data.length/1024).toFixed(1);
      items.push({ slot: i, time, sizeKB, data });
    }
  }
  if(!items.length){
    list.innerHTML = '<div style="font-size:.7rem;color:var(--muted);text-align:center;padding:8px">لا توجد نسخ احتياطية تلقائية بعد</div>';
    return;
  }
  // Sort newest first
  items.sort((a,b) => b.slot - a.slot);
  list.innerHTML = items.map(it => `
    <div style="background:var(--s2);border:1px solid var(--goldbdr);border-radius:8px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:.7rem;color:var(--gold);font-weight:700">نسخة ${it.slot} — ${it.time}</div>
        <div style="font-size:.62rem;color:var(--muted)">الحجم: ${it.sizeKB} كيلوبايت</div>
      </div>
      <button class="btn bgh bsm" onclick="restoreRotationBackup(${it.slot})" style="font-size:.64rem">استعادة</button>
    </div>
  `).join('');
}


// ══ restoreRotationBackup ══
async function restoreRotationBackup(slot){
  const data = localStorage.getItem('auto_backup_rot_'+slot);
  if(!data){ toast('❌ النسخة غير متاحة','err'); return; }
  if(!confirm('⚠️ سيتم استعادة النسخة رقم '+slot+'\nهذا سيحل محل البيانات الحالية. هل تريد المتابعة؟')) return;
  try{
    // backup current first
    autoBackupNow();
    const parsed = JSON.parse(data);
    if(parsed.products) { products = parsed.products; for(const p of products) await dbPut('products',p); }
    if(parsed.customers) { customers = parsed.customers; for(const c of customers) await dbPut('customers',c); }
    if(parsed.invoices) { invoices = parsed.invoices; for(const i of invoices) await dbPut('invoices',i); }
    if(parsed.suppliers) { suppliers = parsed.suppliers; for(const s of suppliers) await dbPut('suppliers',s); }
    await loadAll();
    toast('✅ تم استعادة النسخة الاحتياطية بنجاح 🌟');
    await audit('استعادة نسخة احتياطية', null, 'نسخة رقم '+slot);
  } catch(e){
    toast('❌ خطأ في الاستعادة: '+e.message,'err');
  }
}


// ══ autoBackupNow ══
function autoBackupNow(){
  try{
    const sh=(()=>{try{return JSON.parse(localStorage.getItem('shortagesTable')||'[]');}catch(e){return[];}})();
    const settings=(()=>{try{return JSON.parse(localStorage.getItem('appSettings')||'{}');}catch(e){return{};}})();
    const backup={
      products, customers, invoices, auditLog, suppliers, missing:sh,
      settings, globalProfit,
      time:new Date().toISOString(), version:'3.2'
    };
    const str=JSON.stringify(backup);
    localStorage.setItem('auto_backup',str);
    localStorage.setItem('auto_backup_time',new Date().toLocaleString('ar-EG'));
    // ══ 7-Copy Rotation System ══
    try {
      const rotKey = 'auto_backup_rot_idx';
      const idx = (parseInt(localStorage.getItem(rotKey)||'0') % 7) + 1;
      localStorage.setItem('auto_backup_rot_' + idx, str);
      localStorage.setItem('auto_backup_rot_' + idx + '_time', new Date().toLocaleString('ar-EG'));
      localStorage.setItem(rotKey, idx.toString());
      if(DEBUG) console.log('Auto backup saved (slot '+idx+'):', (str.length/1024).toFixed(1)+'KB');
    } catch(rotErr) { console.warn('Rotation backup failed:', rotErr); }
  }catch(e){ console.warn('Auto backup failed:',e.message); }
}


// ══ backupBeforeImport ══
function backupBeforeImport(){
  try{
    const backup={products,customers,invoices,auditLog,suppliers,time:new Date().toISOString()};
    localStorage.setItem('backup_'+Date.now(),JSON.stringify(backup));
    toast('💾 تم حفظ نسخة احتياطية قبل الاستيراد');
  }catch(e){ console.warn('backupBeforeImport failed:',e.message); }
}


// ══ loadGPSections ══
function loadGPSections(){
  // لا شيء مرئي الآن — الدوال محفوظة فقط
}


// ══ backupData ══
function backupData(){
  try{
    const data={products,customers,invoices,auditLog,suppliers,
      time:new Date().toISOString()};
    localStorage.setItem('backup_'+Date.now(),JSON.stringify(data));
    if(typeof toast==='function') toast('💾 نسخة احتياطية محفوظة');
  }catch(e){ console.warn('backupData:',e.message); }
}


// ══ downloadBackup ══
async function downloadBackup(){
  try{
    const sh=(()=>{try{return JSON.parse(localStorage.getItem('shortagesTable')||'[]');}catch(e){return[];}})();
    const data={
      products,customers,invoices,auditLog,suppliers,missing:sh,
      globalProfit,exportedAt:new Date().toISOString(),version:'3.2'
    };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='toktok-backup-'+new Date().toLocaleDateString('ar-EG').replace(/[/]/g,'-')+'.json';
    a.click(); URL.revokeObjectURL(url);
    toast('✅ تم تحميل النسخة الاحتياطية');
  }catch(e){ toast('❌ خطأ: '+e.message,'err'); }
}
