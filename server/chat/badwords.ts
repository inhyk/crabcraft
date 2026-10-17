// Words masked in chat and refused in names. Ported from inhyk/inhyuk-world services/net/src/badwords.js
// (origin/main 0ea3655, 2026-10-05). filter.ts compares them with spaces, digits and symbols removed, so
// "시 발", "시1발" and "ㅅ.ㅂ" match too. English is lower case. A short word that also occurs inside
// ordinary words needs those words in ALLOWED.
export const BAD_WORDS: readonly string[] = [
  // si-bal family
  '시발', '씨발', '시빨', '씨빨', '시바', '씨바', '씨팔', '시팔', '씨벌', '시벌', '씌발', '쓰발', '쓰바', '썅', '쌍년', '쌍놈',
  'ㅅㅂ', 'ㅆㅂ', 'ㅅㅃ', 'ㅆㅃ', 'ㅅ발', '시ㅂ', '씨ㅂ', 'ㅆ발', 'tlqkf', 'tlqk', 'ssibal', 'sibal', 'shibal',
  // byeong-sin family
  '병신', '븅신', '빙신', '병쉰', '등신', 'ㅂㅅ', 'ㅄ', 'qudtls',
  // gae-sae-kki family
  '개새끼', '개새기', '개색기', '개색끼', '개새', '개세끼', '새끼', '쌔끼', '새키', '색히', 'ㅅㄲ', 'ㄱㅅㄲ',
  // other insults
  '좆', '존나', '졸라', '좃나', 'ㅈㄴ', '지랄', 'ㅈㄹ', '염병', '옘병', '닥쳐', '꺼져', 'ㄲㅈ', '미친놈', '미친년', '미친새', 'ㅁㅊ',
  '엠창', '느금마', '느금', '니애미', '니애비', '니미', '애미', '애비', '앰창', '호로', '후레', '걸레', '찐따', '또라이', 'ㄸㄹㅇ',
  '틀딱', '급식충', '한남충', '맘충', '돌아이', '뒤져', '뒤질래', '디져', '죽어라', '자살해',
  'ㅗ',
  // sexual words
  '보지', '자지', '섹스', '야동', '야스', '딸딸이', '자위', '강간', 'ㅅㅅ',
  // English
  'fuck', 'fuk', 'fck', 'fuq', 'phuck', 'shit', 'bitch', 'biatch', 'asshole', 'bastard', 'dick', 'pussy', 'cunt', 'whore',
  'slut', 'motherfucker', 'wtf', 'stfu', 'nigger', 'nigga', 'retard', 'porn', 'sex',
];

// Ordinary words that contain a bad word; a match inside one of these is not masked.
export const ALLOWED: readonly string[] = [
  '시발점', '시발역', '시발택시', '시바견', '시바이누', '새끼손가락', '새끼발가락', '새끼줄', '새끼고양이', '새끼강아지',
  '새끼오리', '새끼곰', '새끼새', '새끼돼지', '새끼양', '애비뉴', '호로록', '호로요이', '자지러', '보지마', '보지않', '보지도',
  '보지만', '보지못', '보지말', '꺼져서', '꺼져있', '꺼져가', '불이꺼져', '등신대',
  'dickens', 'scunthorpe', 'cocktail', 'sussex', 'essex', 'middlesex', 'sextet', 'sexton',
];
