// ════════════════════════════════════════════════
// invoice.js — نظام الفواتير والطباعة والواتساب
// أيمن الشرنوبى — نظام البيع الذهبي v5.0
// ════════════════════════════════════════════════

// Depends on: products, customers, invoices, globalProfit
// Depends on: fmtDisplay, formatMoney, toast, om, audit, autoBackupNow


// ══ showPrint ══
function showPrint(cust,phn,pay,dt,total,items,paidNow=0,discount=0){
  const hasBat=items.some(i=>CAT_KW.battery.some(k=>(i.name||'').toLowerCase().includes(k.toLowerCase())));
  const invCalc=calcInvoiceFinal(items.map(i=>({...i,unit:i.price,buyPrice:i.buyPrice||0})),discount);
  const warHtml=hasBat?'<div style="background:#f0f9f0;border:2px solid rgba(0,160,80,.3);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:.74rem;color:#006630;text-align:center;font-weight:700">🔋 ضمان البطاريات: من 6 إلى 12 شهراً — التزاماً بحقوق عميلنا الكريم</div>':'';
  
  const shopName = localStorage.getItem('shopName') || 'أيمن الشرنوبى';
  const shopPhone = (document.getElementById('settWA') && document.getElementById('settWA').value) || localStorage.getItem('shopPhone') || '01024306764';

  document.getElementById('printBody').innerHTML=`
    <div style="direction:rtl;font-family:Cairo,Tahoma,sans-serif;max-width:420px;margin:0 auto">
      
      <!-- ══ INVOICE HEADER ══ -->
      <div style="background:linear-gradient(135deg,#0a0800,#1a1300,#0a0800);padding:18px 16px 14px;border-radius:12px 12px 0 0;text-align:center;border:1px solid rgba(212,175,55,.5);border-bottom:none;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#d4af37,#f5d06f,#d4af37,transparent)"></div>
        <div style="position:absolute;bottom:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(212,175,55,.4),transparent)"></div>
        <img src="icon.png" style="width:74px;height:74px;border-radius:50%;border:3px solid #d4af37;display:block;margin:0 auto 10px;object-fit:cover;box-shadow:0 0 20px rgba(212,175,55,.5),0 0 40px rgba(212,175,55,.2)">
        <div style="font-size:1.1rem;font-weight:900;color:#d4af37;letter-spacing:.5px;text-shadow:0 0 10px rgba(212,175,55,.3)">${shopName}</div>
        <div style="font-size:.6rem;color:#8a7a50;margin-top:5px;line-height:1.7">
          لبرمجة ونسخ المفاتيح ✦ صيانة وبيع جميع البطاريات ✦ بيع قطع غيار التوكتوك
        </div>
        <div style="margin-top:10px;display:flex;justify-content:center;gap:16px;flex-wrap:wrap">
          <span style="font-size:.62rem;color:rgba(212,175,55,.7)">📍 البحيرة — مصر</span>
          <span style="font-size:.62rem;color:rgba(212,175,55,.7)">📞 ${shopPhone.replace(/^20/,'0')}</span>
        </div>
      </div>
      
      <!-- ══ INVOICE TITLE BAND ══ -->
      <div style="background:linear-gradient(135deg,#d4af37,#f5d06f,#d4af37);padding:6px 16px;display:flex;justify-content:space-between;align-items:center;border-right:1px solid rgba(212,175,55,.5);border-left:1px solid rgba(212,175,55,.5)">
        <span style="font-size:.72rem;font-weight:900;color:#0a0800;letter-spacing:1px">✦ فاتورة مبيعات رسمية ✦</span>
        <span style="font-size:.62rem;color:#0a0800;font-weight:700">${dt}</span>
      </div>
      
      <!-- ══ CUSTOMER INFO ══ -->
      <div style="background:#faf7ef;border:1px solid rgba(212,175,55,.3);border-top:none;padding:10px 14px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <div>
            <div style="font-size:.7rem;color:#8a7a50;font-weight:600">العميل الكريم</div>
            <div style="font-size:.9rem;font-weight:900;color:#1a1000">${cust}</div>
            ${phn?`<div style="font-size:.65rem;color:#8a7a50;margin-top:2px">📞 ${phn}</div>`:''}
          </div>
          <div style="text-align:left">
            <div style="font-size:.6rem;color:#8a7a50">نوع الدفع</div>
            <div style="padding:4px 12px;border-radius:10px;font-size:.68rem;font-weight:700;
              background:${pay==='cash'?'rgba(0,150,80,.12)':pay==='partial'?'rgba(212,175,55,.15)':'rgba(200,80,0,.1)'};
              color:${pay==='cash'?'#006630':pay==='partial'?'#8a6a00':'#8a3000'};
              border:1px solid ${pay==='cash'?'rgba(0,150,80,.3)':pay==='partial'?'rgba(212,175,55,.4)':'rgba(200,80,0,.2)'}"
            >${pay==='cash'?'💵 نقدي':pay==='partial'?'💳 جزئي':'📋 آجل'}</div>
          </div>
        </div>
      </div>
      
      <!-- ══ ITEMS TABLE ══ -->
      <table style="width:100%;border-collapse:collapse;font-size:.74rem">
        <thead>
          <tr style="background:linear-gradient(135deg,#0a0800,#1a1200)">
            <th style="padding:8px 10px;text-align:right;border:1px solid rgba(212,175,55,.25);color:#d4af37;font-weight:700">الصنف</th>
            <th style="padding:8px 6px;text-align:center;border:1px solid rgba(212,175,55,.25);color:#d4af37;width:40px">الكمية</th>
            <th style="padding:8px 6px;text-align:center;border:1px solid rgba(212,175,55,.25);color:#d4af37;width:60px">السعر</th>
            <th style="padding:8px 6px;text-align:center;border:1px solid rgba(212,175,55,.25);color:#d4af37;width:60px">الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((i,idx)=>`<tr style="background:${idx%2===0?'#fff':'#fdfaf2'}">
            <td style="padding:7px 10px;border:1px solid #e8e0c8;color:#1a1000;font-weight:600">${i.name}</td>
            <td style="padding:7px 6px;text-align:center;border:1px solid #e8e0c8;color:#555">${i.qty}</td>
            <td style="padding:7px 6px;text-align:center;border:1px solid #e8e0c8;color:#555">${fmtDisplay(i.price)}</td>
            <td style="padding:7px 6px;text-align:center;border:1px solid #e8e0c8;font-weight:900;color:#8a4000">${fmtDisplay(i.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      
      <!-- ══ TOTALS ══ -->
      <div style="background:linear-gradient(135deg,#0a0800,#1a1200);border:1px solid rgba(212,175,55,.4);border-top:none;padding:12px 16px">
        ${discount>0?`<div style="display:flex;justify-content:space-between;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid rgba(212,175,55,.15)">
          <span style="color:#8a7a50;font-size:.72rem">الإجمالي قبل الخصم</span>
          <span style="color:#8a7a50;font-size:.72rem">${fmtDisplay(total+discount)} ج</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid rgba(212,175,55,.15)">
          <span style="color:#00c97a;font-size:.72rem">🎁 خصم</span>
          <span style="color:#00c97a;font-size:.72rem">- ${fmtDisplay(discount)} ج</span>
        </div>`:''}
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:#d4af37;font-weight:900;font-size:.9rem">✦ الإجمالي الكلي</span>
          <span style="color:#f5d06f;font-size:1.15rem;font-weight:900">${fmtDisplay(total)} جنيه</span>
        </div>
        ${pay==='partial'?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid rgba(212,175,55,.2)">
          <span style="background:rgba(0,180,100,.15);color:#00c97a;border:1px solid rgba(0,180,100,.3);padding:4px 10px;border-radius:8px;font-size:.68rem;font-weight:700">✅ مدفوع: ${paidNow} ج</span>
          <span style="background:rgba(220,50,50,.1);color:#ff4444;border:1px solid rgba(220,50,50,.2);padding:4px 10px;border-radius:8px;font-size:.68rem;font-weight:700">⏳ متبقي: ${fmtDisplay(total-paidNow)} ج</span>
        </div>`:''}
      </div>
      
      ${warHtml}
      
      <!-- ══ FOOTER MESSAGE ══ -->
      <div style="background:#faf7ef;border:1px solid rgba(212,175,55,.3);border-top:none;border-radius:0 0 0 0;padding:10px 14px;text-align:center">
        <div style="font-size:.72rem;color:#8a6a20;font-weight:700;margin-bottom:4px">لنواصل توفير جميع طلباتكم دائماً</div>
        <div style="font-size:.62rem;color:#aaa">شاكرين ثقتكم الغالية ❤️</div>
      </div>
      
      <!-- ══ QR + FOOTER BRAND ══ -->
      <div style="background:linear-gradient(135deg,#0a0800,#1a1200);border:1px solid rgba(212,175,55,.5);border-top:2px solid rgba(212,175,55,.4);border-radius:0 0 12px 12px;padding:14px 16px">
        <div style="position:absolute;top:0;left:10%;right:10%;height:1px;background:linear-gradient(90deg,transparent,rgba(212,175,55,.4),transparent)"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div style="flex:1">
            <div style="font-size:.78rem;font-weight:900;color:#d4af37;margin-bottom:4px">${shopName}</div>
            <div style="font-size:.6rem;color:#8a7a50;line-height:1.6">📍 البحيرة — مصر</div>
            <div style="font-size:.6rem;color:#8a7a50">📱 فودافون كاش: ${shopPhone.replace(/^20/,'0')}</div>
            <div style="font-size:.58rem;color:rgba(212,175,55,.5);margin-top:6px;letter-spacing:.5px">✦ ✦ ✦</div>
          </div>
          <div id="invoiceQR" style="width:72px;height:72px;background:#fff;border-radius:6px;border:2px solid rgba(212,175,55,.4);display:flex;align-items:center;justify-content:center;flex-shrink:0"></div>
        </div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(212,175,55,.2);text-align:center;font-size:.56rem;color:rgba(212,175,55,.4);letter-spacing:1px">
          نظام نقاط البيع الذهبي — أيمن الشرنوبى
        </div>
      </div>
      
    </div>`;

  // Generate QR Code
  try {
    const qrData = `${shopName}\nالعميل: ${cust}\nالإجمالي: ${total} جنيه\nالتاريخ: ${dt}\nالدفع: ${pay==='cash'?'نقدي':pay==='partial'?'جزئي':'آجل'}`;
    const qrEl = document.getElementById('invoiceQR');
    if(qrEl && typeof QRCode !== 'undefined'){
      new QRCode(qrEl, {
        text: qrData,
        width: 68, height: 68,
        colorDark: '#0a0800',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  } catch(e){ console.log('QR error:', e); }

  om('mPrint');
}


// ══ renderTodaySales ══
function renderTodaySales(){
  const today=new Date().toLocaleDateString('ar-EG');
  const tod=invoices.filter(i=>(i.date||'').startsWith(today)&&i.product!=='سداد دين'&&!i.archived);
  const grouped={};
  tod.forEach(i=>{const k=i.invoiceNum||i.id;if(!grouped[k])grouped[k]={customer:i.customer,date:i.date,payment:i.payment,grandTotal:i.grandTotal||i.total,items:[],invNum:k};grouped[k].items.push(i.product);});
  const rows=Object.values(grouped).sort((a,b)=>b.invNum-a.invNum);
  document.getElementById('todBdg').textContent=rows.length;
  document.getElementById('todTbl').innerHTML=rows.length?rows.map(g=>`<tr>
    <td style="font-size:.68rem;color:var(--muted)">${(g.date||'').split(' ')[1]||''}</td>
    <td><b style="cursor:pointer;color:var(--blue);font-size:.76rem" onclick="showCustTx('${g.customer}')">${g.customer}</b></td>
    <td style="font-size:.68rem">${[...new Set(g.items)].slice(0,2).join('، ')}${g.items.length>2?'...':''}</td>
    <td style="font-weight:700;color:var(--green);white-space:nowrap">${fmtDisplay(g.grandTotal||0)} ج</td>
    <td><span class="${g.payment==='cash'?'bg-b':g.payment==='partial'?'bb-b':'br-b'}" style="font-size:.6rem">${g.payment==='cash'?'نقدي':g.payment==='partial'?'جزئي':'آجل'}</span></td>
    <td><button class="btn bgh bxs" onclick="reprintInv(${g.invNum})">🖨️</button></td>
  </tr>`).join(''):`<tr><td colspan="6"><div class="empty"><div class="empty-ic">🛒</div><p>لا توجد مبيعات اليوم</p></div></td></tr>`;
}


// ══ reprintInv ══
function reprintInv(invNum){
  const items=invoices.filter(i=>i.invoiceNum===invNum&&!i.archived);
  if(!items.length)return;
  const first=items[0];
  currentInvForWA={cust:first.customer,phn:first.phone||'',pay:first.payment,dt:first.date,total:first.grandTotal||items.reduce((s,i)=>s+i.total,0),items:items.map(i=>({name:i.product,qty:i.qty,price:i.unit||0,total:i.total})),paidNow:0};
  showPrint(first.customer,first.phone||'',first.payment,first.date,first.grandTotal||items.reduce((s,i)=>s+i.total,0),items.map(i=>({name:i.product,qty:i.qty,price:i.unit||0,total:i.total})));
}


// ══ sendInvWA ══
function sendInvWA(){
  if(!currentInvForWA)return;
  const {cust,phn,pay,dt,total,items,paidNow}=currentInvForWA;
  let msg=`✨ *أيمن الشرنوبى*\nلبرمجة ونسخ المفاتيح وبيع البطاريات وقطع التوكتوك\n─────────────────────\n📅 ${dt}\n👤 العميل الكريم: ${cust}\n\n`;
  msg+=items.map(i=>`▪️ ${i.name}\n   الكمية: ${i.qty} × ${i.price} = *${i.total.toFixed(2)} ج*`).join('\n')+'\n\n';
  msg+=`━━━━━━━━━━━━━━━\n💰 *الإجمالي: ${total.toFixed(2)} ج*\n`;
  if(pay==='partial') msg+=`✅ مدفوع: ${paidNow} ج\n📋 متبقي: ${(total-paidNow).toFixed(2)} ج\n`;
  msg+=`💳 ${pay==='cash'?'نقدي':pay==='partial'?'دفع جزئي':'آجل'}\n\n─────────────────────\n🌟 شاكرين ثقتكم الغالية\n━ *أيمن الشرنوبى* — البحيرة، مصر`;
  const phone=phn?phn.replace(/[^0-9]/g,'').replace(/^0/,'20'):WA_NUMBER;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,'_blank');
}


// ══ sendInvAsImage ══
async function sendInvAsImage(){
  try{
    const el=document.getElementById('printBody');
    const canvas=await html2canvas(el,{backgroundColor:'#fff',scale:2});
    const link=document.createElement('a');
    link.download=`فاتورة-${Date.now()}.png`;
    link.href=canvas.toDataURL('image/png');
    link.click();
    toast('✅ تم تحميل صورة الفاتورة');
  }catch(e){toast('❌ خطأ في تحويل الفاتورة','err');}
}


// ══ sendDebtWA ══
function sendDebtWA(){
  const n=document.getElementById('txName').textContent.replace('معاملات: ','');
  const c=customers.find(x=>x.name===n);if(!c)return;
  if(!(c.debt>0)){toast('لا يوجد دين لإرساله');return;}
  const msg=
    'عزيزى العميل / ' + c.name + '\n' +
    'من فضل سيادتكم سداد مبلغ *' + c.debt + ' جنيه*' + '\n' +
    'لمحل ايمن الشرنوبى' + '\n\n' +
    'سواء نقداً أو تحويل المبلغ فودافون كاش للرقم:' + '\n' +
    '*01024306764*' + '\n\n' +
    'ولكم منا جزيل الشكر 🙏' + '\n' +
    'شاكرين ثقتكم الكريمة وحسن تعاملكم الراقي 🌟' + '\n\n' +
    '─────────────────' + '\n' +
    'ايمن الشرنوبى لبرمجة ونسخ المفاتيح وصيانة وبيع جميع انواع البطاريات وبيع قطع غيار التوكتوك';
  const phone=(c.phone||'').replace(/[^0-9]/g,'').replace(/^0/,'20');
  window.open('https://wa.me/'+(phone||WA_NUMBER)+'?text='+encodeURIComponent(msg),'_blank');
}


// ══ renderInvoices ══
function renderInvoices(){
  const q=(document.getElementById('invFQ').value||'').toLowerCase();
  const byC={};
  invoices.filter(i=>!i.archived).forEach(i=>{
    if(!byC[i.customer])byC[i.customer]={name:i.customer,total:0,count:0,lastDate:i.date,debt:0};
    byC[i.customer].total+=(i.grandTotal||i.total||0);
    byC[i.customer].count++;
    if(i.date>(byC[i.customer].lastDate||''))byC[i.customer].lastDate=i.date;
  });
  let rows=Object.values(byC).sort((a,b)=>b.lastDate.localeCompare(a.lastDate));
  if(q)rows=rows.filter(r=>r.name.toLowerCase().includes(q)||(r.phone||'').includes(q)||String(r.lastDate||'').includes(q)||invoices.some(i=>i.customer===r.name&&String(i.invoiceNum||'').includes(q)));
  document.getElementById('invList').innerHTML=rows.length?rows.map(c=>{
    const cust=customers.find(x=>x.name===c.name);
    const debt=cust?.debt||0;
    return `<div style="padding:11px;border-bottom:1px solid var(--brd);cursor:pointer;transition:background .15s" onclick="showCustTx('${c.name}')" onmouseover="this.style.background='rgba(255,255,255,.03)'" onmouseout="this.style.background=''">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:9px">
          <div style="width:36px;height:36px;border-radius:50%;background:var(--bdim);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:900;color:var(--blue);flex-shrink:0">${c.name.substring(0,2)}</div>
          <div><b style="color:var(--blue);font-size:.84rem">${c.name}</b><div style="font-size:.65rem;color:var(--muted)">${c.count} معاملة | ${(c.lastDate||'').split(' ')[0]||''}</div></div>
        </div>
        <div style="text-align:left">
          <div style="font-weight:900;color:var(--green);font-size:.85rem">${fmtDisplay(c.total)} ج</div>
          ${debt>0?`<span class="br-b" style="font-size:.6rem">دين: ${debt} ج</span>`:''}
        </div>
      </div>
    </div>`;
  }).join(''):'<div class="empty"><div class="empty-ic">🧾</div><p>لا توجد فواتير</p></div>';
}


// ══ sendShortagesWA ══
function sendShortagesWA(){
  const txt=document.getElementById('shortagesTxt').value.trim();
  if(!txt){toast('اكتب النواقص أولاً','err');return;}
  const msg=`📋 *قائمة النواقص*\n\n${txt}\n\n✨ أيمن الشرنوبى`;
  window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`,'_blank');
}


// ══ sendShortagesWATable ══
function sendShortagesWATable(){
  const rows=shortagesData.filter(r=>r.name);
  if(!rows.length){toast('لا توجد نواقص','err');return;}
  const settings=JSON.parse(localStorage.getItem('appSettings')||'{}');
  const waNum=settings.waNumber||WA_NUMBER;
  const lines=rows.map(r=>'▪️ '+r.name+(r.qty?' ('+r.qty+')':'')).join('\n');
  const text='📋 *قائمة النواقص*\n\n'+lines+'\n\n✨ أيمن الشرنوبى';
  window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(text)}`,'_blank');
}


// ══ filterTodaySales ══
function filterTodaySales(){
  const q=(document.getElementById('todQ')?.value||'').toLowerCase();
  const rows=document.querySelectorAll('#todTbl tr');
  rows.forEach(row=>{
    if(!q){ row.style.display=''; return; }
    const txt=(row.textContent||'').toLowerCase();
    row.style.display=txt.includes(q)?'':'none';
  });
}


// ══ filterInvoices ══
function filterInvoices(){
  const q=(document.getElementById('invFQ')?.value||'').toLowerCase();
  // يعمل بالفعل في renderInvoices - نعيد render
  renderInvoices();
}


// ══ calcInvoiceProfit ══
function calcInvoiceProfit(cartItems){
  try{
    let totalProfit=0;
    (cartItems||[]).forEach(item=>{
      const cost=+(item.buyPrice||item.cost||0);
      const price=+(item.price||item.unit||item.sellPrice||0);
      const qty=+(item.qty||1);
      totalProfit += (price-cost)*qty;
    });
    return formatMoney(totalProfit);
  }catch(e){ return 0; }
}


// ══ calcInvoiceFinal ══
function calcInvoiceFinal(cartItems, discount=0){
  try{
    let total=0, totalCost=0;
    (cartItems||[]).forEach(item=>{
      const price=+(item.price||item.unit||item.sellPrice||0);
      const cost=+(item.buyPrice||item.cost||0);
      const qty=+(item.qty||1);
      total += price*qty;
      totalCost += cost*qty;
    });
    const finalTotal = Math.max(0, total - (discount||0));
    const profit = finalTotal - totalCost;
    return {
      total: formatMoney(finalTotal),
      profit: formatMoney(profit),
      discount: formatMoney(discount||0),
      originalTotal: formatMoney(total)
    };
  }catch(e){ return {total:0,profit:0,discount:0,originalTotal:0}; }
}


// ══ sendDebtReminder ══
function sendDebtReminder(cust){
  if(!(cust.debt>0)) return;
  const phone=(cust.phone||'').replace(/[^0-9]/g,'').replace(/^0/,'20');
  if(!phone||phone.length<10){ toast('لا يوجد رقم للعميل: '+cust.name,'err'); return; }
  const msg=
    '✨ *أيمن الشرنوبى*' + '\n' +
    'لبرمجة ونسخ المفاتيح وبيع البطاريات وقطع التوكتوك' + '\n' +
    '─────────────────────' + '\n\n' +
    'عزيزنا / *' + cust.name + '*' + '\n\n' +
    'نتقدم إليكم بأرقى التحيات وخالص التقدير،' + '\n' +
    'ونُذكِّركم بكل احترام بمديونية بمبلغ:' + '\n' +
    '💰 *' + cust.debt + ' جنيه مصري*' + '\n\n' +
    'يسعدنا استقبال سدادها في أيِّ وقت يناسب حضرتكم،' + '\n' +
    'نقداً أو عبر فودافون كاش:' + '\n' +
    '📲 *01024306764*' + '\n\n' +
    'لنواصل توفير جميع طلباتكم دائماً 🌟' + '\n' +
    'شاكرين ثقتكم الغالية ❤️' + '\n\n' +
    '━ *أيمن الشرنوبى* — البحيرة، مصر';
  window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(msg),'_blank');
}


// ══ remindAllDebts ══
async function remindAllDebts(){
  const debtors=customers.filter(c=>c.debt>0&&!c.archived&&!c.fullyPaid);
  if(!debtors.length){ toast('لا يوجد عملاء مدينون حالياً','err'); return; }
  if(!confirm('هل تود إرسال رسالة مديونية لـ '+debtors.length+' عميل كريم?')) return;
  toast('⏳ جاري إرسال رسائل المديونية...');
  let sent=0;
  for(const c of debtors){
    await new Promise(r=>setTimeout(r,800));
    sendDebtReminder(c);
    sent++;
    toast('📲 '+sent+'/'+debtors.length+' — '+c.name);
  }
  // حفظ وقت آخر تذكير
  localStorage.setItem('lastDebtReminder', Date.now().toString());
  toast('✅ تم إرسال رسالة المديونية بنجاح لـ '+sent+' عميل كريم 🌟');
  await audit('تذكير ديون',null,sent+' عميل');
}


// ══ checkAutoDebtReminder ══
function checkAutoDebtReminder(){
  const last=+localStorage.getItem('lastDebtReminder')||0;
  const WEEK=7*24*60*60*1000;
  if(!last){
    localStorage.setItem('lastDebtReminder', Date.now().toString());
    return;
  }
  if(Date.now()-last >= WEEK){
    const debtors=customers.filter(c=>c.debt>0&&!c.archived&&!c.fullyPaid);
    if(debtors.length>0){
      toast('🔔 يوجد '+debtors.length+' عميل لديه مديونية — يمكنك إرسال التذكير من القائمة الجانبية');
      // إظهار badge تنبيه
      const badge=document.getElementById('debtReminderBadge');
      if(badge){ badge.style.display='flex'; badge.textContent=debtors.length; }
    }
  }
}
