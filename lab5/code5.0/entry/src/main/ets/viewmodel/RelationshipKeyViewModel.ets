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

import { RelationshipKeyItem } from './RelationshipKeyItem';

/**
 * Flag meanings for the relationship keyboard.
 *  0 = relation token (e.g. 爸爸, 妈妈)
 *  1 = title token (mode 3 only, e.g. 伯父)
 *  2 = action: DEL
 *  3 = action: CLR
 */
export class KeyFlag {
  static readonly RELATION: number = 0;
  static readonly TITLE: number = 1;
  static readonly DEL: number = 2;
  static readonly CLR: number = 3;
}

export class RelationshipKeyViewModel {
  /**
   * Relations keyboard (modes 1 & 2).
   * Female titles appear before male titles per requirement.
   * Layout (4 columns x 3 rows):
   *   Row 1: 妈妈, 爸爸, DEL,  CLR
   *   Row 2: 老婆, 老公, 女儿, 儿子
   *   Row 3: 姐姐, 妹妹, 哥哥, 弟弟
   */
  getRelationKeys(): Array<Array<RelationshipKeyItem>> {
    return [
      [
        new RelationshipKeyItem(KeyFlag.RELATION, '妈妈'),
        new RelationshipKeyItem(KeyFlag.RELATION, '爸爸'),
        new RelationshipKeyItem(KeyFlag.DEL, 'DEL'),
        new RelationshipKeyItem(KeyFlag.CLR, 'CLR')
      ],
      [
        new RelationshipKeyItem(KeyFlag.RELATION, '老婆'),
        new RelationshipKeyItem(KeyFlag.RELATION, '老公'),
        new RelationshipKeyItem(KeyFlag.RELATION, '女儿'),
        new RelationshipKeyItem(KeyFlag.RELATION, '儿子')
      ],
      [
        new RelationshipKeyItem(KeyFlag.RELATION, '姐姐'),
        new RelationshipKeyItem(KeyFlag.RELATION, '妹妹'),
        new RelationshipKeyItem(KeyFlag.RELATION, '哥哥'),
        new RelationshipKeyItem(KeyFlag.RELATION, '弟弟')
      ]
    ];
  }

  /**
   * Titles keyboard (mode 3: 根据称呼查询关系).
   * Layout (4 columns x 3 rows):
   *   Row 1: 伯父, 叔叔, 姑姑, 舅舅
   *   Row 2: 姨,   堂哥, 表哥, 嫂子
   *   Row 3: 侄子, 外甥, DEL,   CLR
   */
  getTitleKeys(): Array<Array<RelationshipKeyItem>> {
    return [
      [
        new RelationshipKeyItem(KeyFlag.TITLE, '伯父'),
        new RelationshipKeyItem(KeyFlag.TITLE, '叔叔'),
        new RelationshipKeyItem(KeyFlag.TITLE, '姑姑'),
        new RelationshipKeyItem(KeyFlag.TITLE, '舅舅')
      ],
      [
        new RelationshipKeyItem(KeyFlag.TITLE, '姨'),
        new RelationshipKeyItem(KeyFlag.TITLE, '堂哥'),
        new RelationshipKeyItem(KeyFlag.TITLE, '表哥'),
        new RelationshipKeyItem(KeyFlag.TITLE, '嫂子')
      ],
      [
        new RelationshipKeyItem(KeyFlag.TITLE, '侄子'),
        new RelationshipKeyItem(KeyFlag.TITLE, '外甥'),
        new RelationshipKeyItem(KeyFlag.DEL, 'DEL'),
        new RelationshipKeyItem(KeyFlag.CLR, 'CLR')
      ]
    ];
  }
}

let model = new RelationshipKeyViewModel();

export default model as RelationshipKeyViewModel;