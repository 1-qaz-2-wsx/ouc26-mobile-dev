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

import { ScientificKeyItem } from './ScientificKeyItem';

export class ScientificKeyViewModel {
  /**
   * Scientific function grid, 6 columns x 4 rows (matches the reference):
   *   (    )    MC   M+   M-   MR
   *   x!   x²   x³   xʸ   eˣ   π
   *   1/x  √    ∛x   ʸ√x  Inv  Rad/Deg
   *   e    ln   lg   sin  cos  tan
   */
  getFunctionKeys(): Array<Array<ScientificKeyItem>> {
    return [
      [
        new ScientificKeyItem('lparen', '('),
        new ScientificKeyItem('rparen', ')'),
        new ScientificKeyItem('mem', 'MC', 'mc'),
        new ScientificKeyItem('mem', 'M+', 'mplus'),
        new ScientificKeyItem('mem', 'M-', 'mminus'),
        new ScientificKeyItem('mem', 'MR', 'mr')
      ],
      [
        new ScientificKeyItem('func', 'x!', 'fact'),
        new ScientificKeyItem('func', 'x²', 'square'),
        new ScientificKeyItem('func', 'x³', 'cube'),
        new ScientificKeyItem('pow', 'xʸ'),
        new ScientificKeyItem('func', 'eˣ', 'exp'),
        new ScientificKeyItem('const', 'π', 'pi')
      ],
      [
        new ScientificKeyItem('func', '1/x', 'inv'),
        new ScientificKeyItem('func', '√', 'sqrt'),
        new ScientificKeyItem('func', '∛x', 'cbrt'),
        new ScientificKeyItem('root', 'ʸ√x'),
        new ScientificKeyItem('inv', 'Inv'),
        new ScientificKeyItem('angle', 'Rad')
      ],
      [
        new ScientificKeyItem('const', 'e', 'e'),
        new ScientificKeyItem('func', 'ln', 'ln'),
        new ScientificKeyItem('func', 'lg', 'log'),
        new ScientificKeyItem('func', 'sin', 'sin'),
        new ScientificKeyItem('func', 'cos', 'cos'),
        new ScientificKeyItem('func', 'tan', 'tan')
      ]
    ];
  }

  /**
   * Basic grid, 4 columns x 5 rows (same style as the basic calculator):
   *   C   ×   ÷   ⌫
   *   7   8   9   −
   *   4   5   6   +
   *   1   2   3   %
   *   ±   0   .   =
   */
  getBasicKeys(): Array<Array<ScientificKeyItem>> {
    return [
      [
        new ScientificKeyItem('clear', 'C'),
        new ScientificKeyItem('op', '×', '×'),
        new ScientificKeyItem('op', '÷', '÷'),
        new ScientificKeyItem('del', '⌫')
      ],
      [
        new ScientificKeyItem('digit', '7'),
        new ScientificKeyItem('digit', '8'),
        new ScientificKeyItem('digit', '9'),
        new ScientificKeyItem('op', '−', '-')
      ],
      [
        new ScientificKeyItem('digit', '4'),
        new ScientificKeyItem('digit', '5'),
        new ScientificKeyItem('digit', '6'),
        new ScientificKeyItem('op', '+', '+')
      ],
      [
        new ScientificKeyItem('digit', '1'),
        new ScientificKeyItem('digit', '2'),
        new ScientificKeyItem('digit', '3'),
        new ScientificKeyItem('pct', '%')
      ],
      [
        new ScientificKeyItem('neg', '±'),
        new ScientificKeyItem('digit', '0'),
        new ScientificKeyItem('dot', '.'),
        new ScientificKeyItem('eq', '=')
      ]
    ];
  }
}

let model = new ScientificKeyViewModel();

export default model as ScientificKeyViewModel;
