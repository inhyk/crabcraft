// Chat filter tests, ported from inhyk/inhyuk-world services/net/test/filter.test.js (origin/main 0ea3655) to node:test.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterText, hasProfanity, maskText, maskSplitPhone, nameAllowed } from './filter.ts';

const masked = text => filterText(text).text;

describe('filterText', () => {
  it('masks profanity including spacing, digit and jamo tricks', () => {
    assert.equal(masked('안녕 시발'), '안녕 **');
    assert.equal(masked('시 발 놈아'), '* * 놈아');
    assert.equal(masked('시1발'), '***');
    assert.equal(masked('ㅅㅂ'), '**');
    assert.equal(masked('ㅅ.ㅂ'), '***');
    assert.equal(masked('병​신'), '**');
    assert.equal(masked('이 새끼야'), '이 **야');
    assert.equal(masked('F*CK you'), '**** you');
    assert.equal(masked('ｆｕｃｋ'), '****');
    assert.deepEqual(filterText('개새끼').kinds, ['profanity']);
  });

  it('leaves ordinary sentences alone', () => {
    for (const ok of ['다시 발로 차', '1시 발표', '시발점에서 출발', '시바견 귀여워', '새끼손가락 걸고 약속', 'class assignment', '이번 판 3:2 이겼다',
      '좋은 게임!', 'GG wp', '점수 100점', 'v1.2 업데이트', '라인 좋아', '인스타 좋아', '점수 1234567 점', '고마워 ㅎㅎ']) {
      assert.deepEqual(filterText(ok), { text: ok, kinds: [] }, ok);
    }
  });

  it('does not treat Korean number syllables inside ordinary words as phone digits', () => {
    assert.equal(masked('내 번호 010-1234-5678 이야'), '내 번호 ************* 이야');
    assert.equal(masked('내 번호 공일공 일이삼사 오육칠팔 이야'), '내 번호 *** **** **** 이야');
    assert.equal(maskSplitPhone(['010-1234-5678'], '이야'), '이야');
    assert.ok(filterText('번호공일공일이삼사오육칠팔이야').kinds.includes('phone'));
    assert.deepEqual(filterText('이야기 재미있다'), { text: '이야기 재미있다', kinds: [] });
  });

  it('masks Korean phone numbers in many shapes', () => {
    for (const phone of ['010-1234-5678', '01012345678', '010 1234 5678', '010.1234.5678', '0 1 0 1 2 3 4 5 6 7 8', '+82 10 1234 5678', '02-123-4567', '공일공 일이삼사 오육칠팔', '０１０１２３４５６７８']) {
      const r = filterText(`내 번호 ${phone} 야`);
      assert.ok(r.kinds.includes('phone'), phone);
      assert.doesNotMatch(r.text, /[0-9０-９]{3}/, phone);
    }
  });

  it('masks links, emails and messenger ids', () => {
    for (const [input, kind] of [
      ['naver.com 가봐', 'link'], ['https://evil.example/x', 'link'], ['www.abc.kr', 'link'], ['abc 닷 com', 'link'], ['abc닷컴', 'link'],
      ['me@gmail.com', 'link'], ['me 골뱅이 gmail 닷 com', 'link'], ['카톡 아이디 abc123', 'contact'], ['카톡은 kid_99', 'contact'],
      ['인스타 @cool.kid', 'contact'], ['디코 name#1234', 'contact'], ['아이디: hello12', 'contact'],
    ]) {
      const r = filterText(input);
      assert.ok(r.kinds.includes(kind), input);
      assert.match(r.text, /\*{3}/, input);
    }
    assert.equal(masked('카톡 아이디 abc123'), '** *** ******');
  });

  it('trims, removes control characters and cuts long text', () => {
    assert.equal(masked('  hi\n there\t '), 'hi there');
    assert.equal([...filterText('가'.repeat(500)).text].length, 200);
    assert.equal([...filterText('가'.repeat(500), { max: 300 }).text].length, 300);
    assert.equal(masked(null), '');
  });

  it('hasProfanity for nicknames', () => {
    assert.equal(hasProfanity('시발맨'), true);
    assert.equal(hasProfanity('ssibal'), true);
    assert.equal(hasProfanity('인혁'), false);
    assert.equal(hasProfanity('Sussex_1'), false);
  });

  it('normalizes full-width letters, ideographic dots and spaced-out links before looking, and masks the original text', () => {
    for (const [input, kind] of [
      ['ｅｘａｍｐｌｅ．ｃｏｍ', 'link'], ['n a v e r . c o m', 'link'], ['naver。com', 'link'], ['ｈｔｔｐｓ://x', 'link'],
      ['카톡아이디abc123', 'contact'], ['ktalk: abc123', 'contact'], ['디스코드 닉 abc', 'contact'],
      ['공일공에 일이삼사에 오육칠팔', 'phone'], ['O1O-I234-5678', 'phone'], ['010\u200b1234\u200b5678', 'phone'], ['시바', 'profanity'],
    ]) {
      const r = filterText(input);
      assert.ok(r.kinds.includes(kind), input);
      assert.equal(r.text.replace(/[*\s]/g, ''), '', input); // masked in place of the original characters
      assert.equal([...r.text].length, [...input.replace(/\u200b/g, '')].length, input);
    }
    assert.equal(masked('ｅｘａｍｐｌｅ．ｃｏｍ 봐'), '*********** 봐');
    assert.equal(masked('n a v e r . c o m 와'), '* * * * * * * * * 와');
    // English words written together are not IDs
    for (const ok of ['idea abc', 'ideas', 'a b c', 'www 와 ㅋㅋ', '시바견 귀여워']) assert.deepEqual(filterText(ok), { text: ok, kinds: [] }, ok);
  });

  it('maskText masks game strings in place without trimming or cutting', () => {
    assert.equal(maskText('  sibal010-1234-5678  '), '  ******************  ');
    assert.equal(maskText('a'.repeat(300)), 'a'.repeat(300));
    assert.equal(maskText('board:0102'), 'board:0102');
  });

  it('maskSplitPhone masks the line that completes a number split across lines', () => {
    assert.equal(maskSplitPhone(['010'], '1234'), '1234'); // only seven so far
    assert.equal(maskSplitPhone(['010', '1234'], '5678'), '****');
    assert.equal(maskSplitPhone(['내 번호 010-1234'], '5678 맞아'), '**** 맞아');
    assert.equal(maskSplitPhone([], '5678'), '5678');
    assert.equal(maskSplitPhone(['3:2 이겼다'], '다시 하자 12'), '다시 하자 12');
  });
});

describe('nameAllowed', () => {
  it('refuses character names with profanity, contact details or a phone-length run of digits', () => {
    for (const ok of ['Crab', 'Test crab', '인혁', '집게발 기사', 'Sussex_1', 'Crab 2026']) assert.equal(nameAllowed(ok), true, ok);
    for (const bad of ['시발맨', 'ssibal', 'F*CK crab', 'naver.com', '카톡 kid_99', '@cool.kid', '0101234567', 'crab01012345']) assert.equal(nameAllowed(bad), false, bad);
  });
});
