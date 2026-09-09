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

/**
 * Scientific calculator key item.
 *
 * type semantics:
 *   digit  - 0..9
 *   dot    - decimal point
 *   pct    - percent (divide current number by 100)
 *   neg    - negate ±
 *   op     - binary operator (+ - × ÷)
 *   eq     - equals
 *   clear  - C (clear all)
 *   del    - backspace
 *   func   - unary function; op holds the CalculateUtil op name
 *   const  - constant; op holds 'pi' or 'e'
 *   mem    - memory; op holds 'mc' | 'mplus' | 'mminus' | 'mr'
 *   inv    - toggle inverse functions
 *   angle  - toggle Rad/Deg angle mode
 *   pow    - x^y two-step power
 *   root   - y-th root two-step
 *   lparen / rparen - parentheses
 */
export class ScientificKeyItem {
  type: string;
  label: string;
  op?: string;

  constructor(type: string, label: string, op?: string) {
    this.type = type;
    this.label = label;
    this.op = op;
  }
}
