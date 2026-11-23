"use strict";



const test = require("node:test");
const assert = require("node:assert/strict");
const { ApiClient, extractToken, normalizeFields, normalizeWeighments } = require("../src/api-client");

test("scale settings password is verified with the current token without logging in again", async () => {
  let request;
  const client = new ApiClient({baseUrl:"https://example.test/api/v1", token:"current-token", fetchImpl:async (url, options) => {
    request = {url, options}; return {ok:true, text:async()=>'{"verified":true}'};
  }});
  await client.verifyPassword("example-password");
  assert.match(request.url, /\/auth\/verify-password$/);
  assert.equal(request.options.headers.Authorization, "Bearer current-token");
  assert.deepEqual(JSON.parse(request.options.body), {password:"example-password"});
});

test("extracts a token from common API envelopes", () => {
  assert.equal(extractToken({ data: { token: "abc" } }), "abc");
  assert.equal(extractToken({ access_token: "xyz" }), "xyz");
});

test("normalizes API dynamic fields and canonical keys", () => {
  const fields = normalizeFields({ data: [
    { id: 1, field_key: "vehicle_plate_number", label: "Vehicle Plate Number", field_type: "text", is_required: true, display_order: 1 },
    { id: 2, key: "material", label: "Material", type: "select", options: ["Coal", "Sand"], order: 2 }
  ] });
  assert.equal(fields[0].key, "vehiclePlate");
  assert.equal(fields[0].required, true);
  assert.equal(fields[1].type, "dropdown");
  assert.deepEqual(fields[1].options, ["Coal", "Sand"]);
});

test("preserves the server slug for a canonicalized required driver field", () => {
  const { buildCustomFields } = require("../src/logic");
  const fields = normalizeFields({data:[
    {id: 6, slug:"driver", name:"Driver", type:"text", is_required:true, is_active:true},
    {id: 2, slug:"quality_check", name:"Vehicle Plate Number", type:"text", is_required:true, is_active:true},
    {id: 5, slug:"company", name:"Company", type:"text", is_required:true, is_active:true}
  ]});
  const result = buildCustomFields(fields, {driverName:"Sample Driver", quality_check:"T578DZE", company:"Example"});
  assert.deepEqual(result, {driver:"Sample Driver", quality_check:"T578DZE", company:"Example"});
});

test("normalizes paginated weighment records", () => {
  const records = normalizeWeighments({ data: { data: [{
    id: 44,
    weighment_number: "WB-44",
    vehicle_plate_number: "RJ14 AB 1234",
    driver_name: "Amit",
    material_name: "Coal",
    gross_weight: "28000",
    tare_weight: null,
    gross_source: "Live",
    status: "tare_pending"
  }] } });
  assert.equal(records.length, 1);
  assert.equal(records[0].serverId, 44);
  assert.equal(records[0].fields.vehiclePlate, "RJ14 AB 1234");
  assert.equal(records[0].status, "TARE_PENDING");
});

test("loads every page of weighments so older pending vehicles remain visible", async () => {
  const urls = [];
  const client = new ApiClient({baseUrl:"https://example.test/api/v1", token:"test", fetchImpl:async (url) => {
    urls.push(url); const page = urls.length;
    return {ok:true, text:async()=>JSON.stringify({data:[{id:page,gross_weight:100}],meta:{current_page:page,last_page:2}})};
  }});
  assert.deepEqual((await client.allWeighments()).map(r=>r.id), [1,2]);
  assert.match(urls[1], /page=2&per_page=100/);
});

test("API client sends bearer authorization and JSON", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { id: 5 } }) };
  };
  const client = new ApiClient({ baseUrl: "https://example.test/api/v1", token: "secret", fetchImpl });
  await client.updateWeighment(5, { tare_weight: 1000 });
  assert.equal(request.url, "https://example.test/api/v1/weighments/5");
  assert.equal(request.options.method, "PUT");
  assert.equal(request.options.headers.Authorization, "Bearer secret");
  assert.equal(request.options.body, JSON.stringify({ tare_weight: 1000 }));
});

test("API client creates Gross records with POST", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 201, text: async () => JSON.stringify({ data: { id: 25, weighment_number: "WB-25" } }) };
  };
  const client = new ApiClient({ baseUrl: "https://example.test/api/v1", token: "secret", fetchImpl });
  const result = await client.createWeighment({ vehicle_plate_number: "RJ14 AB 1234", gross_weight: 28000, request_id: "REQ-1" });
  assert.equal(request.url, "https://example.test/api/v1/weighments");
  assert.equal(request.options.method, "POST");
  assert.equal(result.data.id, 25);
});

test("legacy report download method is not exposed", () => {
  assert.equal(typeof new ApiClient({baseUrl:"https://example.test"}).inwardReport, "undefined");
});

test('report request sends the password to the protected endpoint and rejects non-PDF responses', async () => {
  const { ApiClient } = require('../src/api-client');
  let request;
  const client = new ApiClient({baseUrl:'https://example.test/api/v1',token:'token',fetchImpl:async (url, options)=>{request={url,options}; return new Response(Buffer.from('%PDF-example'),{status:200,headers:{'content-type':'application/pdf'}});}});
  const pdf=await client.report(7,'secret');
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.equal(request.url,'https://example.test/api/v1/weighments/7/inward-report');
  assert.equal(JSON.parse(request.options.body).password,'secret');
  assert.equal(request.options.headers.Authorization,'Bearer token');
  client.fetchImpl=async()=>new Response(JSON.stringify({errors:{password:['The password is incorrect.']}}),{status:422,headers:{'content-type':'application/json'}});
  await assert.rejects(client.report(7,'bad'),/password is incorrect/);
  client.fetchImpl=async()=>new Response('not pdf',{status:200,headers:{'content-type':'text/html'}});
  await assert.rejects(client.report(7,'secret'),/valid PDF/);
});
