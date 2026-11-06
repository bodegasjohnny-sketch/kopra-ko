// Synthetic records only. Never copy a device backup into test fixtures.
module.exports=()=>({
 settings:[{id:'settings',startDate:'2026-01-01',copraPrice:50,ulingPrice:20,bagolRatio:.2,targetMargin:.5,lifeMargin:2,lifeInBid:false,partners:['Partner A','Partner B'],budget:{Gas:.1,Labor:.1,'Merienda / meals':.04}}],
 batches:[
  {id:'partial',no:1,date:'2026-01-01',source:'Supplier A',rawKg:1000,buyTotal:8000,copraKg:250},
  {id:'dry',no:2,date:'2026-01-02',source:'Supplier B',rawKg:500,buyTotal:4000,copraKg:0},
  {id:'unsold',no:3,date:'2026-01-03',source:'Supplier C',rawKg:300,buyTotal:2400,copraKg:90},
  {id:'complete',no:4,date:'2026-01-04',source:'Supplier D',rawKg:200,buyTotal:1800,copraKg:50},
  {id:'pending',no:5,date:'2026-01-05',source:'Supplier E',rawKg:400,buyTotal:3000,copraKg:80},
  {id:'deleted-batch',no:6,rawKg:9999,buyTotal:9999,copraKg:100,deleted:true}
 ],
 sales:[{id:'sale-part',batch_id:'partial',date:'2026-01-06',kg:100,price:40,buyer:'Buyer A'},
  {id:'sale-complete',batch_id:'complete',kg:50,price:42},
  {id:'sale-pending',batch_id:'pending',kg:40,price:45},
  {id:'sale-unassigned',batch_id:null,from_batch:'pending',lineage_copra:90,kg:10,price:45},
  {id:'deleted-sale',batch_id:'partial',kg:10,price:99,deleted:true}],
 expenses:[{id:'bill-part',batch_id:'partial',category:'Gas',amount:200},
  {id:'bill-dry',batch_id:'dry',category:'Gas',amount:100},
  {id:'bill-unsold',batch_id:'unsold',category:'Labor',amount:30},
  {id:'bill-pending',batch_id:'pending',category:'Gas',amount:40},
  {id:'bill-general',category:'Merienda / meals',amount:60},
  {id:'bill-uling',category:'Uling',amount:70},
  {id:'bill-linked-uling',batch_id:'partial',category:'Uling',amount:10},
  {id:'deleted-bill',category:'Gas',amount:9999,deleted:true}],
 charcoal:[{id:'burn-done',no:1,bagolKg:100,ulingKg:30,status:'done'},
  {id:'burn-kiln',no:2,bagolKg:50,ulingKg:9,status:'burning'},
  {id:'deleted-burn',no:3,bagolKg:100,ulingKg:90,status:'done',deleted:true}],
 uling_sales:[{id:'usale',kg:15,price:20},{id:'deleted-usale',kg:10,price:99,deleted:true}],
 lifetime_items:[{id:'cap',name:'Example rack',kind:'capital',amount:100},
  {id:'one-off',name:'Example permit',kind:'expense',amount:50},
  {id:'deleted-life',name:'Deleted',kind:'capital',amount:9999,deleted:true}]
});
