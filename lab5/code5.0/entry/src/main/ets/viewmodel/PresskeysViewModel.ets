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

import { PressKeyItem } from './PressKeysItem';

export class PressKeysViewModel {
  /**
   * Basic calculator keyboard, 4 columns x 5 rows (row-based).
   *   C   ×   ÷   ⌫
   *   7   8   9   −
   *   4   5   6   +
   *   1   2   3   %
   *   ±   0   .   =
   */
  getPressKeys(): Array<Array<PressKeyItem>> {
    return [
      [
        new PressKeyItem(2, 'C'),
        new PressKeyItem(2, '×'),
        new PressKeyItem(2, '÷'),
        new PressKeyItem(0, 'del', $r('app.media.ic_delete'))
      ],
      [
        new PressKeyItem(1, '7'),
        new PressKeyItem(1, '8'),
        new PressKeyItem(1, '9'),
        new PressKeyItem(2, '-')
      ],
      [
        new PressKeyItem(1, '4'),
        new PressKeyItem(1, '5'),
        new PressKeyItem(1, '6'),
        new PressKeyItem(2, '+')
      ],
      [
        new PressKeyItem(1, '1'),
        new PressKeyItem(1, '2'),
        new PressKeyItem(1, '3'),
        new PressKeyItem(1, '%')
      ],
      [
        new PressKeyItem(4, '±'),
        new PressKeyItem(1, '0'),
        new PressKeyItem(1, '.'),
        new PressKeyItem(3, '=')
      ]
    ];
  }
}

let keysModel = new PressKeysViewModel();

export default keysModel as PressKeysViewModel;
