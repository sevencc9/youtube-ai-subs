const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../ai-segments.js');
test('accepts complete ordered coverage',()=>assert.equal(validate([{start:0,end:1,translation:'你好'},{start:2,end:2,translation:'再见'}],3).length,2));
for(const [name, rows] of Object.entries({gap:[{start:1,end:2,translation:'x'}],overlap:[{start:0,end:1,translation:'x'},{start:1,end:2,translation:'x'}],missing:[{start:0,end:1,translation:'x'}],outside:[{start:0,end:3,translation:'x'}],empty:[{start:0,end:2,translation:' '}],fraction:[{start:0,end:2.5,translation:'x'}]})) test('rejects '+name,()=>assert.throws(()=>validate(rows,3)));
const {units,materialize,commit}=require('../ai-segments.js');
test('splits inside an original cue while retaining every word and timing',()=>{
 const input=units([{text:'First sentence. Next sentence.',start:1000,end:5000}]);
 const output=materialize(input,[{start:0,end:1,translation:'第一句。'},{start:2,end:3,translation:'下一句。'}]);
 assert.deepEqual(output.map(c=>c.text),['First sentence.','Next sentence.']);
 assert.equal(output[0].start,1000);assert.equal(output[0].dur,2000);
 assert.equal(output[1].start,3000);assert.equal(output[1].end,5000);
});
test('unfinished associated with tail is retained across batches',()=>{
 const rows=[{start:0,end:2,translation:'第一句'},{start:3,end:7,translation:'与…关联'}];
 assert.deepEqual(commit(rows,false),[rows[0]]);
 assert.deepEqual(commit(rows,true),rows);
 assert.deepEqual(commit([rows[0]],false),[]);
});
test('publishes committed prefix without requiring unfinished tail coverage',()=>{
 const words=units([{text:'This ends. Next sentence continues',start:0,end:5000}]);
 const rows=[{start:0,end:1,translation:'此句结束。'},{start:2,end:4,translation:'下一句继续'}];
 const output=materialize(words,commit(rows,false));
 assert.equal(output.length,1);assert.equal(output[0].text,'This ends.');
 assert.equal(words.slice(rows[0].end+1).map(w=>w.text).join(' '),'Next sentence continues');
});
const {boundaryIssues}=require('../ai-segments.js');
test('flags dangling prepositions but permits unfinished final batch tail',()=>{
 const words=['kinds','of','matrices'];
 assert.equal(boundaryIssues([{start:0,end:1,translation:'种类'},{start:2,end:2,translation:'矩阵'}],words).length,1);
 assert.equal(boundaryIssues([{start:0,end:2,translation:'矩阵种类'}],words).length,0);
});
const {generate,errorInfo}=require('../ai-segments.js');
const valid=JSON.stringify([{start:0,end:1,translation:'你好'}]);
test('repairs malformed JSON once',async()=>{
 let calls=0; const rows=await generate(['hello','there'],async correction=>{
  calls++; if(calls===1) return 'bad json';
  assert.match(correction.reason,/JSON/);return valid;
 });assert.equal(calls,2);assert.equal(rows.length,1);
});
test('repairs missing indices once',async()=>{
 let calls=0;await generate(['hello','there'],async()=>++calls===1?'[{"start":0,"end":0,"translation":"你好"}]':valid);
 assert.equal(calls,2);
});
test('persistent invalid format reports JSON failure, not auth',async()=>{
 let calls=0;await assert.rejects(generate(['hello'],async()=>{calls++;return 'broken';}),{code:'aiJson'});
 assert.equal(calls,2);assert.doesNotMatch(errorInfo({code:'aiJson'}).message,/密钥/);
});
test('does not retry authentication or network errors',async()=>{
 for(const code of ['auth','netfail']) {
  let calls=0;await assert.rejects(generate(['hello'],async()=>{calls++;throw Object.assign(Error('private secret'),{code});}),{code});
  assert.equal(calls,1);assert.ok(!JSON.stringify(errorInfo({code,message:'private secret'})).includes('private secret'));
 }
});
test('repairs dangling boundary and retranslates',async()=>{
 let calls=0;await generate(['kinds','of','matrices'],async()=>++calls===1?
 JSON.stringify([{start:0,end:1,translation:'种类'},{start:2,end:2,translation:'矩阵'}]):
 JSON.stringify([{start:0,end:2,translation:'矩阵的种类'}]));assert.equal(calls,2);
});
test('grammatical sentence-final preposition does not stop processing after review',async()=>{
 const words='this is the person I spoke with now we continue'.split(' ');
 const rows=[{start:0,end:6,translation:'这就是和我说话的人。'},{start:7,end:9,translation:'现在我们继续。'}];
 let calls=0;
 const result=await generate(words,async()=>{calls++;return JSON.stringify(rows);});
 assert.equal(calls,2);assert.deepEqual(result,rows);
 assert.equal(boundaryIssues(result,words).length,1);
 const committed=commit(result,false);
 assert.equal(materialize(units([{text:words.join(' '),start:0,end:10000}]),committed).length,1);
});
test('persistent suspicious boundary preserves words and translations without stopping',async()=>{
 const rows=[{start:0,end:1,translation:'种类'},{start:2,end:2,translation:'矩阵'}];
 const result=await generate(['kinds','of','matrices'],async()=>JSON.stringify(rows));
 assert.deepEqual(result,rows);
});
test('boundary review does not permit corrupted replacement coverage',async()=>{
 let calls=0;
 await assert.rejects(generate(['kinds','of','matrices'],async()=>++calls===1?
 JSON.stringify([{start:0,end:1,translation:'种类'},{start:2,end:2,translation:'矩阵'}]):
 JSON.stringify([{start:0,end:1,translation:'种类'}])),{code:'aiCoverage'});
 assert.equal(calls,2);
});
