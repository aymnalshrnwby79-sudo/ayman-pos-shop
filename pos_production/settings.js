// ════════════════════════════════════════════════
// settings.js — الإعدادات والتخصيص والباركود
// أيمن الشرنوبى — نظام البيع الذهبي v5.0
// ════════════════════════════════════════════════

// Barcode scanner state
let barcodeBuffer = '';
let barcodeTimer = null;
let barcodeActive = false;


// ══ showDebtAlert ══
function showDebtAlert(){
  const debtors=customers.filter(c=>(c.debt||0)>0);
  if(!debtors.length)return;
  const el=document.getElementById('debtAlertList');
  el.innerHTML=debtors.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px;background:var(--s2);border-radius:var(--rs);margin-bottom:7px">
    <div><b>${c.name}</b>${c.phone&&c.phone!=='—'?`<br><span style="font-size:.66rem;color:var(--muted)">${c.phone}</span>`:''}
    </div>
    <div style="text-align:left">
      <div style="color:var(--red);font-weight:900">${c.debt} ج</div>
      ${c.phone&&c.phone!=='—'?`<a href="https://wa.me/${(c.phone||'').replace(/[^0-9]/g,'').replace(/^0/,'20')}?text=${encodeURIComponent('✨ أيمن الشرنوبى\n─────────────\nعزيزنا / '+c.name+'\nنذكِّركم بمديونية: 💰 '+c.debt+' جنيه\nفودافون كاش: 01024306764\n\nلنواصل توفير جميع طلباتكم دائماً 🌟')}" target="_blank" style="font-size:.64rem;color:#25D366">واتساب</a>`:''}
    </div>
  </div>`).join('');
  const ad=document.getElementById('debtAlert');
  if(ad) ad.style.display='flex';
}


// ══ changeFontSize ══
function changeFontSize(delta){
  fontSize=Math.max(11,Math.min(22,fontSize+delta));
  const s=document.getElementById('fontStyle')||(()=>{const x=document.createElement('style');x.id='fontStyle';document.head.appendChild(x);return x;})();
  s.textContent=`td,th,.ci-name,.ci-info,h3,h4,b,p,span:not(.icon),.card-head h3{font-size:${fontSize}px!important}.btn{font-size:${Math.max(11,fontSize-2)}px!important}label{font-size:${Math.max(10,fontSize-2)}px!important}`;
  localStorage.setItem('fs',fontSize);
}


// ══ hardRefresh ══
function hardRefresh(){if('caches'in window)caches.keys().then(ks=>{ks.forEach(k=>caches.delete(k));}).then(()=>location.reload(true));else location.reload(true);}


// ══ loadSettings ══
function loadSettings(){
  const saved=JSON.parse(localStorage.getItem('appSettings')||'{}');
  const wn=document.getElementById('settWA'); if(wn) wn.value=saved.waNumber||WA_NUMBER;
  const gp=document.getElementById('settGP'); if(gp) gp.value=saved.globalProfit||globalProfit;
  const ap=document.getElementById('settAP'); if(ap) ap.value='';
}


// ══ saveSettings ══
function saveSettings(){
  const waNum=(document.getElementById('settWA')?.value||'').trim();
  const gp=+document.getElementById('settGP')?.value||0;
  const newPwd=(document.getElementById('settNewPwd')?.value||'').trim();
  const shopName=(document.getElementById('settShopName')?.value||'').trim();
  const address=(document.getElementById('settAddress')?.value||'').trim();
  
  const settings={waNumber:waNum||WA_NUMBER, globalProfit:gp, shopName, address};
  localStorage.setItem('appSettings',JSON.stringify(settings));
  
  if(shopName) updateShopName(shopName);
  if(address) localStorage.setItem('shopAddress', address);
  if(waNum) localStorage.setItem('shopPhone', waNum);
  
  if(newPwd){
    localStorage.setItem('adminPwd',newPwd);
    toast('✅ تم حفظ كلمة مرور المدير الجديدة');
  }
  globalProfit=gp;
  document.getElementById('gpVal').value=gp;
  document.getElementById('gpLabel').textContent=(gp>=0?'+':'')+gp+'%';
  toast('✅ تم حفظ إعدادات المحل بنجاح 🌟');
  autoBackupNow();
}


// ══ renderSettings ══
function renderSettings(){
  loadSettings();
}


// ══ renderRotationBackups ══


// ══ restoreRotationBackup ══


// ══ checkOverdueDebts ══
function checkOverdueDebts(){
  const now = Date.now();
  const MS_15 = 15 * 24 * 60 * 60 * 1000;
  const overdue = customers.filter(c=>{
    if(!(c.debt>0)) return false;
    // نحاول نعرف تاريخ آخر معاملة
    const custInvs = invoices.filter(i=>i.customer===c.name&&i.product!=='سداد دين');
    if(!custInvs.length) return true; // دين بدون فاتورة = قديم
    const lastInv = custInvs.sort((a,b)=>b.id-a.id)[0];
    // نحاول نحول التاريخ العربي لـ timestamp
    try{
      const parts=(lastInv.date||'').split(' ')[0].split('/');
      if(parts.length===3){
        const d=new Date(+parts[2],+parts[1]-1,+parts[0]);
        return (now-d.getTime())>MS_15;
      }
    }catch(e){}
    return false;
  });
  if(!overdue.length) return;
  const alEl=document.getElementById('overdueAlert');
  if(alEl){
    alEl.innerHTML=overdue.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:9px;background:var(--s2);border-radius:var(--rs);margin-bottom:7px;border:1px solid var(--rbdr)">
      <div>
        <b style="color:var(--text)">${c.name}</b>
        ${c.phone&&c.phone!=='—'?`<div style="font-size:.66rem;color:var(--muted)">${c.phone}</div>`:''}
      </div>
      <div style="text-align:left">
        <div style="color:var(--red);font-weight:900;font-size:.85rem">${c.debt} ج</div>
        <div style="font-size:.62rem;color:var(--muted)">تأخر 15+ يوم</div>
      </div>
    </div>`).join('');
    document.getElementById('overdueCount').textContent=overdue.length;
    document.getElementById('overdueAlertBox').style.display='flex';
  }
}


// ══ setStyle ══
function setStyle(id, prop, val){
  const el=document.getElementById(id);
  if(el) el.style[prop]=val;
}


// ══ setDisplay ══
function setDisplay(id, val){
  const el=document.getElementById(id);
  if(el) el.style.display=val;
}


// ══ getEl ══
function getEl(id){ return document.getElementById(id)||{style:{},textContent:'',innerHTML:'',className:'',classList:{add:()=>{},remove:()=>{},toggle:()=>{}}}; }


// ══ resetAllData ══
async function resetAllData(){
  const pwd=prompt('🔐 أدخل كلمة مرور المدير للتأكيد:');
  if(!pwd) return;
  const adminPwd=localStorage.getItem('adminPwd')||ADMIN_PWD;
  if(pwd!==adminPwd){toast('❌ كلمة المرور غلط!','err');return;}
  if(!confirm('⚠️ سيتم حذف كل البيانات (منتجات + عملاء + فواتير + موردين)\nهذا الإجراء لا يمكن التراجع عنه!\n\nهل أنت متأكد؟')) return;
  if(!confirm('تأكيد أخير: حذف كل شيء؟')) return;
  try{
    // backup قبل المسح
    autoBackupNow();
    toast('⏳ جاري المسح...');
    const stores=['products','customers','invoices','auditLog','suppliers'];
    for(const s of stores){
      const all=await dbAll(s);
      for(const r of all) await dbDel(s,r.id);
    }
    // مسح shortages
    localStorage.removeItem('shortagesTable');
    await loadAll();
    renderHome();renderInv();renderCusts();renderInvoices();
    toast('✅ تم مسح كل البيانات — يمكنك الاستيراد الآن');
  }catch(e){toast('❌ خطأ: '+e.message,'err');}
}


// ══ cleanDuplicates ══
async function cleanDuplicates(){
  if(!confirm('تنظيف المكررات من المنتجات؟\nسيتم الاحتفاظ بالنسخة الأحدث من كل منتج.')) return;
  toast('⏳ جاري التنظيف...');
  let cleaned=0;
  const unique=[];
  for(const p of products){
    if(p.archived) continue;
    const ex=unique.find(x=>x.name.trim()===p.name.trim());
    if(!ex){
      unique.push({...p});
    } else {
      cleaned++;
      // احتفظ بالأحدث
      if((p.lastUpdated||p.id||0)>(ex.lastUpdated||ex.id||0)){
        const idx=unique.indexOf(ex);
        unique[idx]={...p, id:ex.id}; // نحافظ على الـ ID الأقدم
      }
      // احذف النسخة المكررة من DB
      await dbDel('products',p.id);
    }
  }
  // تحديث النسخ المتبقية
  for(const p of unique){ await dbPut('products',p); }
  await loadAll(); renderInv(); updateDashboard();
  toast('✅ تم تنظيف '+cleaned+' منتج مكرر');
}


// ══ confirmReset ══
function confirmReset(callback){
  const adminPwd = localStorage.getItem('adminPwd') || ADMIN_PWD;
  const pass = prompt('🔐 أدخل كلمة مرور المدير لتأكيد العملية:');
  if(pass === adminPwd){
    if(typeof callback === 'function') callback();
  } else {
    toast('❌ تم إلغاء العملية — كلمة المرور غير صحيحة', 'err');
  }
}


// ══ updateShopName ══
function updateShopName(name){
  if(!name.trim()) return;
  localStorage.setItem('shopName', name.trim());
  const el=document.getElementById('appNameDisplay');
  if(el) el.textContent=name.trim();
}


// ══ loadShopName ══
function loadShopName(){
  const saved=localStorage.getItem('shopName');
  if(saved){
    const el=document.getElementById('appNameDisplay');
    if(el) el.textContent=saved;
    const inp=document.getElementById('settShopName');
    if(inp) inp.value=saved;
  }
  // Load other settings
  const addr = localStorage.getItem('shopAddress');
  if(addr){ const el=document.getElementById('settAddress'); if(el) el.value=addr; }
  const phone = localStorage.getItem('shopPhone');
  if(phone){ const el=document.getElementById('settWA'); if(el && !el.value) el.value=phone; }
}


// ══ activateBarcodeInput ══
function activateBarcodeInput(){
  barcodeActive = !barcodeActive;
  const btn = document.getElementById('barcodeStatusBtn');
  if(barcodeActive){
    if(btn){ btn.textContent = '🟢 نشط'; btn.style.color = 'var(--green)'; }
    toast('📷 نظام الباركود نشط — امسح المنتج الآن');
    // Focus on product search if on inventory
    const searchEl = document.getElementById('pSearch') || document.getElementById('cartSearch');
    if(searchEl) searchEl.focus();
  } else {
    if(btn){ btn.textContent = '⚪ متوقف'; btn.style.color = ''; }
    toast('⏸️ تم إيقاف نظام الباركود');
  }
}


// ══ handleBarcodeScan ══
function handleBarcodeScan(code){
  console.log('[Barcode] Scanned:', code);
  
  // Search in products
  const found = products.find(p => 
    p.barcode === code || 
    p.name === code || 
    (p.sku && p.sku === code)
  );
  
  if(found){
    toast('✅ تم العثور على: ' + found.name);
    // Add to cart if on invoice section
    const activeSection = document.querySelector('.section.active');
    if(activeSection && activeSection.id === 'sec-home'){
      addToCart(found.id || found.name);
    }
    // Fill product search
    const searchEl = document.getElementById('pSearch');
    if(searchEl){ searchEl.value = code; renderInv(); }
  } else {
    toast('⚠️ الباركود غير موجود: ' + code, 'warn');
    // Fill in barcode field if adding new product
    const barcodeField = document.getElementById('pBarcode');
    if(barcodeField) barcodeField.value = code;
  }
}


// ══ USB Barcode Scanner listener ══
document.addEventListener('keydown', function(e){
  if(!barcodeActive) return;
  if(e.key === 'Enter' && barcodeBuffer.length > 3){
    const code = barcodeBuffer.trim();
    barcodeBuffer = '';
    clearTimeout(barcodeTimer);
    handleBarcodeScan(code);
    return;
  }
  if(e.key.length === 1){
    barcodeBuffer += e.key;
    clearTimeout(barcodeTimer);
    barcodeTimer = setTimeout(() => { barcodeBuffer = ''; }, 100);
  }
});
