/*
 * Copyright (c) 2025 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import CheckEmptyUtil from './CheckEmptyUtil';

/**
 * User gender.
 */
export type Gender = 'M' | 'F';

/**
 * Which family side a relative connects through.
 */
export type Side = 'paternal' | 'maternal' | 'spouse' | 'self';

/**
 * Birth order within siblings (elder / younger).
 */
export type BirthOrder = 'elder' | 'younger';

/**
 * Kinship category of a person relative to me.
 *  - lineal: direct ancestors or descendants (parents, grandparents, children, grandchildren).
 *  - sibling: my brothers / sisters.
 *  - parentSibling: parents' siblings (uncles / aunts).
 *  - siblingSpouse: my siblings' spouses (sisters-in-law / brothers-in-law).
 *  - parentInLaw: my spouse's parents.
 *  - spouse: my husband / wife.
 *  - siblingChild: my brothers'/sisters' children (nephews / nieces).
 *  - cousin: my parents' siblings' children.
 */
export type KinshipCategory =
  | 'lineal'
  | 'sibling'
  | 'parentSibling'
  | 'siblingSpouse'
  | 'parentInLaw'
  | 'spouse'
  | 'siblingChild'
  | 'cousin';

/**
 * A person in the kinship graph, expressed relative to me.
 */
export class KinshipNode {
  gen: number = 0;
  gender: Gender = 'M';
  side: Side = 'self';
  birthOrder: BirthOrder | undefined = undefined;
  category: KinshipCategory = 'lineal';

  constructor(gen: number, gender: Gender, side: Side,
    birthOrder: BirthOrder | undefined, category: KinshipCategory) {
    this.gen = gen;
    this.gender = gender;
    this.side = side;
    this.birthOrder = birthOrder;
    this.category = category;
  }
}

/**
 * Relation tokens (the 10 buttons on the keyboard).
 */
export class KinshipToken {
  static readonly FATHER: string = '爸爸';
  static readonly MOTHER: string = '妈妈';
  static readonly HUSBAND: string = '老公';
  static readonly WIFE: string = '老婆';
  static readonly SON: string = '儿子';
  static readonly DAUGHTER: string = '女儿';
  static readonly ELDER_BROTHER: string = '哥哥';
  static readonly YOUNGER_BROTHER: string = '弟弟';
  static readonly ELDER_SISTER: string = '姐姐';
  static readonly YOUNGER_SISTER: string = '妹妹';

  static readonly ALL: string[] = [
    KinshipToken.FATHER, KinshipToken.MOTHER,
    KinshipToken.HUSBAND, KinshipToken.WIFE,
    KinshipToken.SON, KinshipToken.DAUGHTER,
    KinshipToken.ELDER_BROTHER, KinshipToken.YOUNGER_BROTHER,
    KinshipToken.ELDER_SISTER, KinshipToken.YOUNGER_SISTER
  ];
}

/**
 * Compute the node produced by applying a single token to "me".
 */
function tokenToNodeFromMe(token: string, myGender: Gender): KinshipNode | null {
  switch (token) {
    case KinshipToken.FATHER:
      return new KinshipNode(1, 'M', 'paternal', undefined, 'lineal');
    case KinshipToken.MOTHER:
      return new KinshipNode(1, 'F', 'maternal', undefined, 'lineal');
    case KinshipToken.HUSBAND:
      if (myGender === 'F') {
        return new KinshipNode(0, 'M', 'spouse', undefined, 'spouse');
      }
      return null;
    case KinshipToken.WIFE:
      if (myGender === 'M') {
        return new KinshipNode(0, 'F', 'spouse', undefined, 'spouse');
      }
      return null;
    case KinshipToken.SON:
      return new KinshipNode(-1, 'M', 'self', undefined, 'lineal');
    case KinshipToken.DAUGHTER:
      return new KinshipNode(-1, 'F', 'self', undefined, 'lineal');
    case KinshipToken.ELDER_BROTHER:
      return new KinshipNode(0, 'M', 'self', 'elder', 'sibling');
    case KinshipToken.YOUNGER_BROTHER:
      return new KinshipNode(0, 'M', 'self', 'younger', 'sibling');
    case KinshipToken.ELDER_SISTER:
      return new KinshipNode(0, 'F', 'self', 'elder', 'sibling');
    case KinshipToken.YOUNGER_SISTER:
      return new KinshipNode(0, 'F', 'self', 'younger', 'sibling');
  }
  return null;
}

/**
 * Apply a token to the current person (relative to me).
 * Implements the Chinese kinship transition rules for the supported tokens.
 */
function applyTokenToNode(cur: KinshipNode, token: string): KinshipNode | null {
  // Father of current person.
  if (token === KinshipToken.FATHER) {
    // Parent's parent -> grandparent (lineal, gen+1, same side).
    if (cur.category === 'lineal' && cur.gen >= 1) {
      return new KinshipNode(cur.gen + 1, 'M', cur.side, undefined, 'lineal');
    }
    if (cur.category === 'sibling') {
      // My sibling's father = my father.
      return new KinshipNode(1, 'M', 'paternal', undefined, 'lineal');
    }
    if (cur.category === 'parentSibling') {
      // Uncle/aunt's father = my grandparent.
      return new KinshipNode(2, 'M', cur.side, undefined, 'lineal');
    }
    if (cur.category === 'spouse') {
      // Spouse's father = father-in-law.
      return new KinshipNode(1, 'M', 'spouse', undefined, 'parentInLaw');
    }
    if (cur.category === 'parentInLaw') {
      // Grandfather-in-law.
      return new KinshipNode(cur.gen + 1, 'M', 'spouse', undefined, 'lineal');
    }
    if (cur.category === 'siblingChild') {
      // Nephew/niece's father = my brother (if nephew's father = my brother)
      // side paternal if the siblingChild was reached via brother, maternal via sister.
      const side: Side = cur.side === 'maternal' ? 'maternal' : 'paternal';
      const bo: BirthOrder | undefined = cur.birthOrder;
      return new KinshipNode(0, 'M', side, bo, 'sibling');
    }
    if (cur.category === 'cousin') {
      // Cousin's father = my uncle/aunt (parentSibling).
      return new KinshipNode(1, 'M', cur.side, undefined, 'parentSibling');
    }
    return null;
  }

  // Mother of current person.
  if (token === KinshipToken.MOTHER) {
    if (cur.category === 'lineal' && cur.gen >= 1) {
      return new KinshipNode(cur.gen + 1, 'F', cur.side, undefined, 'lineal');
    }
    if (cur.category === 'sibling') {
      return new KinshipNode(1, 'F', 'maternal', undefined, 'lineal');
    }
    if (cur.category === 'parentSibling') {
      return new KinshipNode(2, 'F', cur.side, undefined, 'lineal');
    }
    if (cur.category === 'spouse') {
      return new KinshipNode(1, 'F', 'spouse', undefined, 'parentInLaw');
    }
    if (cur.category === 'parentInLaw') {
      return new KinshipNode(cur.gen + 1, 'F', 'spouse', undefined, 'lineal');
    }
    if (cur.category === 'siblingChild') {
      const side: Side = cur.side === 'maternal' ? 'maternal' : 'paternal';
      const bo: BirthOrder | undefined = cur.birthOrder;
      return new KinshipNode(0, 'F', side, bo, 'sibling');
    }
    if (cur.category === 'cousin') {
      return new KinshipNode(1, 'F', cur.side, undefined, 'parentSibling');
    }
    return null;
  }

  // Husband of current person (valid only when current is female).
  if (token === KinshipToken.HUSBAND) {
    if (cur.gender !== 'F') {
      return null;
    }
    return new KinshipNode(cur.gen, 'M', cur.side, undefined, cur.category);
  }

  // Wife of current person (valid only when current is male).
  if (token === KinshipToken.WIFE) {
    if (cur.gender !== 'M') {
      return null;
    }
    return new KinshipNode(cur.gen, 'F', cur.side, undefined, cur.category);
  }

  // Son of current person.
  if (token === KinshipToken.SON) {
    if (cur.category === 'lineal' && cur.gen >= 1) {
      // Parent's son comes back to me (or my brother) - treat as returning to self for chain continuity.
      return new KinshipNode(0, 'M', 'self', undefined, 'lineal');
    }
    if (cur.category === 'sibling') {
      // My sibling's son = my nephew.
      const side: Side = cur.gender === 'M' ? 'paternal' : 'maternal';
      const bo: BirthOrder | undefined = cur.birthOrder;
      return new KinshipNode(-1, 'M', side, bo, 'siblingChild');
    }
    if (cur.category === 'parentSibling') {
      // Uncle/aunt's son = my cousin.
      return new KinshipNode(0, 'M', cur.side, undefined, 'cousin');
    }
    if (cur.category === 'spouse') {
      // Spouse's son (from another marriage) - treat as my child for kinship.
      return new KinshipNode(-1, 'M', 'self', undefined, 'lineal');
    }
    if (cur.category === 'parentInLaw') {
      return new KinshipNode(cur.gen - 1, 'M', 'spouse', undefined, 'siblingSpouse');
    }
    if (cur.category === 'lineal' && cur.gen === -1) {
      // My child's son = my grandson.
      return new KinshipNode(cur.gen - 1, 'M', cur.side, undefined, 'lineal');
    }
    if (cur.category === 'siblingChild') {
      // Nephew's son - treat as another siblingChild / extended.
      return new KinshipNode(cur.gen - 1, 'M', cur.side, cur.birthOrder, 'siblingChild');
    }
    if (cur.category === 'cousin') {
      // Cousin's son.
      return new KinshipNode(-1, 'M', cur.side, undefined, 'cousin');
    }
    if (cur.category === 'siblingSpouse') {
      return new KinshipNode(cur.gen - 1, 'M', cur.side, cur.birthOrder, 'siblingChild');
    }
    return null;
  }

  // Daughter of current person.
  if (token === KinshipToken.DAUGHTER) {
    if (cur.category === 'lineal' && cur.gen >= 1) {
      return new KinshipNode(0, 'F', 'self', undefined, 'lineal');
    }
    if (cur.category === 'sibling') {
      const side: Side = cur.gender === 'M' ? 'paternal' : 'maternal';
      const bo: BirthOrder | undefined = cur.birthOrder;
      return new KinshipNode(-1, 'F', side, bo, 'siblingChild');
    }
    if (cur.category === 'parentSibling') {
      return new KinshipNode(0, 'F', cur.side, undefined, 'cousin');
    }
    if (cur.category === 'spouse') {
      return new KinshipNode(-1, 'F', 'self', undefined, 'lineal');
    }
    if (cur.category === 'parentInLaw') {
      return new KinshipNode(cur.gen - 1, 'F', 'spouse', undefined, 'siblingSpouse');
    }
    if (cur.category === 'lineal' && cur.gen === -1) {
      return new KinshipNode(cur.gen - 1, 'F', cur.side, undefined, 'lineal');
    }
    if (cur.category === 'siblingChild') {
      return new KinshipNode(cur.gen - 1, 'F', cur.side, cur.birthOrder, 'siblingChild');
    }
    if (cur.category === 'cousin') {
      return new KinshipNode(-1, 'F', cur.side, undefined, 'cousin');
    }
    if (cur.category === 'siblingSpouse') {
      return new KinshipNode(cur.gen - 1, 'F', cur.side, cur.birthOrder, 'siblingChild');
    }
    return null;
  }

  // Elder brother of current person.
  if (token === KinshipToken.ELDER_BROTHER) {
    if (cur.category === 'lineal' && cur.gen >= 1) {
      // Parent's elder brother = 伯父.
      return new KinshipNode(1, 'M', cur.side, 'elder', 'parentSibling');
    }
    if (cur.category === 'sibling') {
      // My sibling's elder brother = back to "me or my elder brother" - treat as self.
      return new KinshipNode(0, 'M', 'self', 'elder', 'sibling');
    }
    if (cur.category === 'parentSibling') {
      // Uncle/aunt's elder brother = my parent (if same gender side) or another uncle.
      if (cur.gender === 'M') {
        return new KinshipNode(1, 'M', cur.side, undefined, 'lineal');
      }
      return new KinshipNode(1, 'M', cur.side, 'elder', 'parentSibling');
    }
    if (cur.category === 'spouse') {
      // Spouse's elder brother = 大伯子 / 大舅子 (in-law sibling).
      return new KinshipNode(0, 'M', 'spouse', 'elder', 'siblingSpouse');
    }
    if (cur.category === 'lineal' && cur.gen === -1) {
      // My child's elder brother = my other son.
      return new KinshipNode(-1, 'M', cur.side, 'elder', 'lineal');
    }
    return null;
  }

  // Younger brother of current person.
  if (token === KinshipToken.YOUNGER_BROTHER) {
    if (cur.category === 'lineal' && cur.gen >= 1) {
      return new KinshipNode(1, 'M', cur.side, 'younger', 'parentSibling');
    }
    if (cur.category === 'sibling') {
      return new KinshipNode(0, 'M', 'self', 'younger', 'sibling');
    }
    if (cur.category === 'parentSibling') {
      if (cur.gender === 'M') {
        return new KinshipNode(1, 'M', cur.side, undefined, 'lineal');
      }
      return new KinshipNode(1, 'M', cur.side, 'younger', 'parentSibling');
    }
    if (cur.category === 'spouse') {
      return new KinshipNode(0, 'M', 'spouse', 'younger', 'siblingSpouse');
    }
    if (cur.category === 'lineal' && cur.gen === -1) {
      return new KinshipNode(-1, 'M', cur.side, 'younger', 'lineal');
    }
    return null;
  }

  // Elder sister of current person.
  if (token === KinshipToken.ELDER_SISTER) {
    if (cur.category === 'lineal' && cur.gen >= 1) {
      return new KinshipNode(1, 'F', cur.side, 'elder', 'parentSibling');
    }
    if (cur.category === 'sibling') {
      return new KinshipNode(0, 'F', 'self', 'elder', 'sibling');
    }
    if (cur.category === 'parentSibling') {
      if (cur.gender === 'F') {
        return new KinshipNode(1, 'F', cur.side, undefined, 'lineal');
      }
      return new KinshipNode(1, 'F', cur.side, 'elder', 'parentSibling');
    }
    if (cur.category === 'spouse') {
      return new KinshipNode(0, 'F', 'spouse', 'elder', 'siblingSpouse');
    }
    if (cur.category === 'lineal' && cur.gen === -1) {
      return new KinshipNode(-1, 'F', cur.side, 'elder', 'lineal');
    }
    return null;
  }

  // Younger sister of current person.
  if (token === KinshipToken.YOUNGER_SISTER) {
    if (cur.category === 'lineal' && cur.gen >= 1) {
      return new KinshipNode(1, 'F', cur.side, 'younger', 'parentSibling');
    }
    if (cur.category === 'sibling') {
      return new KinshipNode(0, 'F', 'self', 'younger', 'sibling');
    }
    if (cur.category === 'parentSibling') {
      if (cur.gender === 'F') {
        return new KinshipNode(1, 'F', cur.side, undefined, 'lineal');
      }
      return new KinshipNode(1, 'F', cur.side, 'younger', 'parentSibling');
    }
    if (cur.category === 'spouse') {
      return new KinshipNode(0, 'F', 'spouse', 'younger', 'siblingSpouse');
    }
    if (cur.category === 'lineal' && cur.gen === -1) {
      return new KinshipNode(-1, 'F', cur.side, 'younger', 'lineal');
    }
    return null;
  }

  return null;
}

/**
 * Walk a chain of tokens starting from "me" and return the final node.
 */
function chainToNode(chain: string[], myGender: Gender): KinshipNode | null {
  let node: KinshipNode | null = null;
  for (let i = 0; i < chain.length; i++) {
    const token = chain[i];
    if (CheckEmptyUtil.isEmpty(token)) {
      return null;
    }
    if (i === 0) {
      node = tokenToNodeFromMe(token, myGender);
    } else {
      if (!node) {
        return null;
      }
      node = applyTokenToNode(node, token);
    }
    if (!node) {
      return null;
    }
  }
  return node;
}

/**
 * Convert a KinshipNode into the Chinese title used to address that person.
 */
function nodeToTitle(node: KinshipNode, myGender: Gender): string {
  // Gen +2 grandparents.
  if (node.gen === 2 && node.category === 'lineal') {
    if (node.side === 'paternal' && node.gender === 'M') return '爷爷';
    if (node.side === 'paternal' && node.gender === 'F') return '奶奶';
    if (node.side === 'maternal' && node.gender === 'M') return '外公';
    if (node.side === 'maternal' && node.gender === 'F') return '外婆';
  }

  // Gen +1 parents and uncles/aunts.
  if (node.gen === 1 && node.category === 'lineal') {
    if (node.side === 'paternal' && node.gender === 'M') return '爸爸';
    if (node.side === 'maternal' && node.gender === 'F') return '妈妈';
  }
  if (node.gen === 1 && node.category === 'parentSibling') {
    if (node.side === 'paternal' && node.gender === 'M' && node.birthOrder === 'elder') return '伯父';
    if (node.side === 'paternal' && node.gender === 'M' && node.birthOrder === 'younger') return '叔叔';
    if (node.side === 'paternal' && node.gender === 'F') return '姑姑';
    if (node.side === 'maternal' && node.gender === 'M') return '舅舅';
    if (node.side === 'maternal' && node.gender === 'F') return '姨';
  }
  if (node.gen === 1 && node.category === 'parentInLaw') {
    // Father/Mother-in-law: depends on user's gender.
    if (node.gender === 'M') {
      return myGender === 'F' ? '公公' : '岳父';
    }
    if (node.gender === 'F') {
      return myGender === 'F' ? '婆婆' : '岳母';
    }
  }

  // Gen 0 spouse, siblings, in-law siblings, cousins.
  if (node.gen === 0 && node.category === 'spouse') {
    return myGender === 'F' ? '老公' : '老婆';
  }
  if (node.gen === 0 && node.category === 'sibling') {
    if (node.gender === 'M' && node.birthOrder === 'elder') return '哥哥';
    if (node.gender === 'M' && node.birthOrder === 'younger') return '弟弟';
    if (node.gender === 'F' && node.birthOrder === 'elder') return '姐姐';
    if (node.gender === 'F' && node.birthOrder === 'younger') return '妹妹';
  }
  if (node.gen === 0 && node.category === 'siblingSpouse') {
    // My sibling's spouse.
    if (myGender === 'F') {
      // User is female: elder brother's wife = 嫂子; younger brother's wife = 弟妹.
      // Elder sister's husband = 姐夫; younger sister's husband = 妹夫.
      if (node.gender === 'F') {
        return node.birthOrder === 'elder' ? '嫂子' : '弟妹';
      }
      if (node.gender === 'M') {
        return node.birthOrder === 'elder' ? '姐夫' : '妹夫';
      }
    } else {
      // User is male: same titles.
      if (node.gender === 'F') {
        return node.birthOrder === 'elder' ? '嫂子' : '弟妹';
      }
      if (node.gender === 'M') {
        return node.birthOrder === 'elder' ? '姐夫' : '妹夫';
      }
    }
  }
  if (node.gen === 0 && node.category === 'cousin') {
    // 堂 (paternal uncle side) vs 表 (others).
    const isPaternalCousin = node.side === 'paternal';
    if (node.gender === 'M' && node.birthOrder === 'elder') return isPaternalCousin ? '堂哥' : '表哥';
    if (node.gender === 'M' && node.birthOrder === 'younger') return isPaternalCousin ? '堂弟' : '表弟';
    if (node.gender === 'F' && node.birthOrder === 'elder') return isPaternalCousin ? '堂姐' : '表姐';
    if (node.gender === 'F' && node.birthOrder === 'younger') return isPaternalCousin ? '堂妹' : '表妹';
    // Fallback when birth order is unknown.
    if (node.gender === 'M') return isPaternalCousin ? '堂兄弟' : '表兄弟';
    if (node.gender === 'F') return isPaternalCousin ? '堂姐妹' : '表姐妹';
  }

  // Gen -1 children and nephews/nieces.
  if (node.gen === -1 && node.category === 'lineal') {
    if (node.gender === 'M') return '儿子';
    if (node.gender === 'F') return '女儿';
  }
  if (node.gen === -1 && node.category === 'siblingChild') {
    // Brother's child = 侄子/侄女 (paternal). Sister's child = 外甥/外甥女 (maternal).
    if (node.side === 'maternal') {
      return node.gender === 'M' ? '外甥' : '外甥女';
    }
    return node.gender === 'M' ? '侄子' : '侄女';
  }

  // Gen -2 grandchildren.
  if (node.gen === -2 && node.category === 'lineal') {
    if (node.gender === 'M' && node.side === 'self') return '孙子';
    if (node.gender === 'F' && node.side === 'self') return '孙女';
    if (node.gender === 'M') return '外孙';
    if (node.gender === 'F') return '外孙女';
  }

  return '未知';
}

/**
 * Convert a KinshipNode into the title that person uses to address me (reverse).
 */
function nodeToReverseTitle(node: KinshipNode, myGender: Gender): string {
  // Build the equivalent node from "their" perspective pointing to me.
  // The reverse title of node.title for me is what they call me.
  // Use the symmetric mapping by re-deriving from category / side / gender.
  if (node.category === 'lineal') {
    if (node.gen === 1) {
      // My parent calls me 儿子/女儿.
      return myGender === 'M' ? '儿子' : '女儿';
    }
    if (node.gen === -1) {
      // My child calls me 爸爸/妈妈.
      return myGender === 'M' ? '爸爸' : '妈妈';
    }
    if (node.gen === 2) {
      // Grandparent calls me 孙子/孙女 (or 外孙/外孙女 for maternal).
      if (node.side === 'maternal') {
        return myGender === 'M' ? '外孙' : '外孙女';
      }
      return myGender === 'M' ? '孙子' : '孙女';
    }
    if (node.gen === -2) {
      return myGender === 'M' ? '爷爷' : '奶奶';
    }
  }
  if (node.category === 'sibling') {
    // My sibling calls me 哥哥/弟弟/姐姐/妹妹 by birth order.
    if (myGender === 'M') {
      return node.birthOrder === 'elder' ? '弟弟' : '哥哥';
    }
    return node.birthOrder === 'elder' ? '妹妹' : '姐姐';
  }
  if (node.category === 'parentSibling') {
    // Uncle/aunt calls me 侄子/侄女 (paternal) or 外甥/外甥女 (maternal).
    if (node.side === 'maternal') {
      return myGender === 'M' ? '外甥' : '外甥女';
    }
    return myGender === 'M' ? '侄子' : '侄女';
  }
  if (node.category === 'siblingSpouse') {
    // My sibling's spouse calls me by sibling-of-spouse rules.
    return '—';
  }
  if (node.category === 'spouse') {
    return myGender === 'F' ? '老婆' : '老公';
  }
  if (node.category === 'parentInLaw') {
    // Father/Mother-in-law calls me by spouse's relation.
    if (myGender === 'F') {
      return node.gender === 'M' ? '儿媳' : '儿媳';
    }
    return node.gender === 'M' ? '女婿' : '女婿';
  }
  if (node.category === 'siblingChild') {
    // Nephew/niece calls me 伯父/伯母/叔叔/姑姑 etc.
    if (node.side === 'maternal') {
      // Sister's child -> 姨夫/姨妈.
      return myGender === 'M' ? '姨夫' : '姨妈';
    }
    // Brother's child -> 伯父/叔叔/姑姑.
    return myGender === 'M' ? '叔叔' : '姑姑';
  }
  if (node.category === 'cousin') {
    return '—';
  }
  return '—';
}

/**
 * Get the title to address the person described by the chain.
 */
export function getTitleByChain(chain: string[], myGender: Gender): string {
  if (CheckEmptyUtil.isEmpty(chain)) {
    return '';
  }
  if (chain.length === 1) {
    const first = chain[0];
    if (first === KinshipToken.HUSBAND && myGender !== 'F') return '—';
    if (first === KinshipToken.WIFE && myGender !== 'M') return '—';
  }
  const node = chainToNode(chain, myGender);
  if (!node) {
    return '—';
  }
  return nodeToTitle(node, myGender);
}

/**
 * Get the reverse title (what this person calls me).
 */
export function getReverseTitleByChain(chain: string[], myGender: Gender): string {
  if (CheckEmptyUtil.isEmpty(chain)) {
    return '';
  }
  const node = chainToNode(chain, myGender);
  if (!node) {
    return '—';
  }
  return nodeToReverseTitle(node, myGender);
}

/**
 * Build a human-readable description of the chain (e.g. "爸爸的哥哥").
 */
export function getChainDescription(chain: string[]): string {
  if (CheckEmptyUtil.isEmpty(chain)) {
    return '';
  }
  return chain.join('的');
}

/**
 * Title -> relationship description map (for mode 3: 根据称呼查询关系).
 */
const TITLE_TO_RELATION: Record<string, string> = {
  '爷爷': '爸爸的爸爸',
  '奶奶': '爸爸的妈妈',
  '外公': '妈妈的爸爸',
  '外婆': '妈妈的妈妈',
  '伯父': '爸爸的哥哥',
  '叔叔': '爸爸的弟弟',
  '姑姑': '爸爸的姐妹',
  '舅舅': '妈妈的兄弟',
  '姨': '妈妈的姐妹',
  '堂哥': '爸爸的兄弟的儿子（年长）',
  '堂弟': '爸爸的兄弟的儿子（年幼）',
  '堂姐': '爸爸的兄弟的女儿（年长）',
  '堂妹': '爸爸的兄弟的女儿（年幼）',
  '表哥': '爸爸的姐妹 / 妈妈的兄弟姐妹的儿子（年长）',
  '表弟': '爸爸的姐妹 / 妈妈的兄弟姐妹的儿子（年幼）',
  '表姐': '爸爸的姐妹 / 妈妈的兄弟姐妹的女儿（年长）',
  '表妹': '爸爸的姐妹 / 妈妈的兄弟姐妹的女儿（年幼）',
  '嫂子': '哥哥的妻子',
  '弟妹': '弟弟的妻子',
  '姐夫': '姐姐的丈夫',
  '妹夫': '妹妹的丈夫',
  '侄子': '兄弟的儿子',
  '侄女': '兄弟的女儿',
  '外甥': '姐妹的儿子',
  '外甥女': '姐妹的女儿',
  '公公': '老公的父亲',
  '婆婆': '老公的母亲',
  '岳父': '老婆的父亲',
  '岳母': '老婆的母亲',
  '大伯子': '老公的哥哥',
  '小叔子': '老公的弟弟',
  '大姑子': '老公的姐姐',
  '小姑子': '老公的妹妹',
  '大舅子': '老婆的哥哥',
  '小舅子': '老婆的弟弟',
  '大姨子': '老婆的姐姐',
  '小姨子': '老婆的妹妹'
};

/**
 * Get the relationship description for a given title (mode 3).
 */
export function getRelationByTitle(title: string): string {
  if (CheckEmptyUtil.isEmpty(title)) {
    return '';
  }
  const desc = TITLE_TO_RELATION[title];
  if (desc) {
    return desc;
  }
  return '—';
}

/**
 * Try to extend the chain by appending one more token. Returns the new chain
 * if the resulting chain is still valid, or null if the token is not allowed
 * at the current node (e.g. trying to marry your dad to a husband).
 *
 * The UI should call this when a key is tapped. When null is returned, the
 * caller simply keeps the previous chain — the invalid attempt is silently
 * dropped, no "—" placeholder is shown, and subsequent keys may continue
 * to extend the chain.
 */
export function tryAppendToken(chain: string[], token: string, myGender: Gender): string[] | null {
  if (CheckEmptyUtil.isEmpty(token)) {
    return chain;
  }
  const candidate: string[] = chain.concat([token]);
  if (chainToNode(candidate, myGender) === null) {
    return null;
  }
  return candidate;
}

/**
 * Singleton-style facade for kinship queries. Each method delegates to the
 * module-level function implementations below so external callers can use
 * `import { KinshipUtil } from '../common/util/KinshipUtil'` cleanly.
 */
export class KinshipUtil {
  static getTitleByChain(chain: string[], myGender: Gender): string {
    return getTitleByChain(chain, myGender);
  }

  static getReverseTitleByChain(chain: string[], myGender: Gender): string {
    return getReverseTitleByChain(chain, myGender);
  }

  static getChainDescription(chain: string[]): string {
    return getChainDescription(chain);
  }

  static getRelationByTitle(title: string): string {
    return getRelationByTitle(title);
  }

  static tryAppendToken(chain: string[], token: string, myGender: Gender): string[] | null {
    return tryAppendToken(chain, token, myGender);
  }
}