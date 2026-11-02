import test from 'node:test';
import assert from 'node:assert/strict';
import {webHost} from '../src/web-url.js';
import {prepareReportRecord,brandWebHost} from '../src/report-policy.js';

test('正文引用、搜索来源和官网共用严格网页 URL 规则',()=>{
  for(const value of ['javascript:alert(1)','ftp://example.com/a','https://user:secret@example.com/a','https://example.com/a\n','not a url']) {
    assert.equal(webHost(value),null,value);
  }
  assert.equal(webHost('HTTPS://WWW.Example.com./path'),'example.com');
  assert.equal(brandWebHost('example.com'),'example.com');
  assert.equal(brandWebHost('https://user:secret@example.com'),null);
  const record=prepareReportRecord({status:'succeeded',answer:'回答',kind:'discovery',question:'问题',brand:{name:'品牌',website:'https://brand.example'},
    citations:[{url:'https://user:secret@brand.example/source'}],searchedSites:[{url:'javascript:alert(1)'}],reportedCitationCount:0,reportedSearchCount:0});
  assert.equal(record.citations.length,0);
  assert.equal(record.searchedSites.length,0);
  assert.equal(record.citationCompleteness,'inconsistent');
  assert.equal(record.searchCompleteness,'inconsistent');
  assert.equal(record.discardedCitationCount,1);
  assert.equal(record.discardedSearchCount,1);
});
