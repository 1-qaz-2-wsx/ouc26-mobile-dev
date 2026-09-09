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

import { CommonConstants, Priority, SymbolicEnumeration } from '../constants/CommonConstants';
import CheckEmptyUtil from './CheckEmptyUtil';

class CalculateUtil {
  /**
   * Unary/built-in function names understood by the scientific expression
   * parser. These are the `op` values pushed as tokens by the scientific page.
   */
  static readonly FUNCTIONS: string[] = [
    'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
    'ln', 'log', 'exp', 'pow10', 'sqrt', 'cbrt',
    'abs', 'square', 'cube', 'fact', 'inv', 'neg'
  ];

  /**
   * Round a value to `digits` significant digits, cleaning floating-point
   * noise (e.g. tan(pi/4) -> 1 instead of 0.9999999999999983).
   */
  static roundSignificant(value: number, digits: number): number {
    if (!isFinite(value) || isNaN(value) || value === 0) {
      return value;
    }
    const magnitude: number = Math.floor(Math.log10(Math.abs(value)));
    const factor: number = Math.pow(10, digits - 1 - magnitude);
    return Math.round(value * factor) / factor;
  }

  /**
   * Determines whether it is an operator.
   *
   * @param value The symbol.
   * @return Is Operator.
   */
  isSymbol(value: string): boolean {
    if (CheckEmptyUtil.isEmpty(value)) {
      return false;
    }
    return (CommonConstants.OPERATORS.indexOf(value) !== -1);
  }

  /**
   * Determines whether the token is a built-in function name.
   *
   * @param value The token.
   * @return Is Function.
   */
  isFunction(value: string): boolean {
    if (CheckEmptyUtil.isEmpty(value)) {
      return false;
    }
    return (CalculateUtil.FUNCTIONS.indexOf(value) !== -1);
  }

  /**
   * Get Operator Precedence.
   *
   * @param value The symbol.
   * @return Priority.
   */
  getPriority(value: string): number {
    if (CheckEmptyUtil.isEmpty(value)) {
      return Priority.LOW;
    }
    let result = 0;
    switch (value) {
      case SymbolicEnumeration.ADD:
      case SymbolicEnumeration.MIN:
        result = Priority.MEDIUM;
        break;
      case SymbolicEnumeration.MUL:
      case SymbolicEnumeration.DIV:
        result = Priority.HIGH;
        break;
      default:
        result = Priority.LOW;
        break;
    }
    return result;
  }

  /**
   * Determine the priority of addition, subtraction, multiplication, and division.
   *
   * @param arg1 Parameter 1.
   * @param arg2 Parameter 2.
   * @return Compare Priority Results.
   */
  comparePriority(arg1: string, arg2: string): boolean {
    if (CheckEmptyUtil.isEmpty(arg1) || CheckEmptyUtil.isEmpty(arg2)) {
      return false;
    }
    return (this.getPriority(arg1) <= this.getPriority(arg2));
  }

  /**
   * Expression Processing.
   * Supports + - × ÷, % postfix, and ( ) parentheses tokens.
   * Unbalanced parentheses are tolerated (extra '(' discarded, extra ')' ignored).
   *
   * @param expressions Expressions.
   */
  parseExpression(expressions: Array<string>, angleMode?: string): string {
    if (CheckEmptyUtil.isEmpty(expressions)) {
      return 'NaN';
    }
    // Preprocess: expand % postfix and drop a trailing binary operator.
    for (let i = 0; i < expressions.length; i++) {
      const item = expressions[i];
      if (item.indexOf(CommonConstants.PERCENT_SIGN) !== -1) {
        expressions[i] = (this.mulOrDiv(item.slice(0, item.length - 1),
          CommonConstants.ONE_HUNDRED, CommonConstants.DIV)).toString();
      }
    }
    const lastIdx: number = expressions.length - 1;
    if (lastIdx >= 0 && this.isSymbol(expressions[lastIdx])) {
      expressions.pop();
    }
    let outputStack: string[] = [];
    let outputQueue: string[] = [];
    while (expressions.length > 0) {
      const current: string | undefined = expressions.shift();
      if (current === undefined) {
        continue;
      }
      if (current === '(') {
        outputStack.push(current);
        continue;
      }
      if (current === ')') {
        while (outputStack.length > 0 && outputStack[outputStack.length - 1] !== '(') {
          const popped: string | undefined = outputStack.pop();
          if (popped !== undefined) {
            outputQueue.push(popped);
          }
        }
        if (outputStack.length > 0) {
          outputStack.pop(); // discard the matching '('
        }
        // A function token directly below '(' applies to this sub-expression.
        if (outputStack.length > 0 && this.isFunction(outputStack[outputStack.length - 1])) {
          const fn: string | undefined = outputStack.pop();
          if (fn !== undefined) {
            outputQueue.push(fn);
          }
        }
        continue;
      }
      if (this.isFunction(current)) {
        outputStack.push(current);
        continue;
      }
      if (this.isSymbol(current)) {
        // Processing addition, subtraction, multiplication and division.
        while (outputStack.length > 0 &&
          outputStack[outputStack.length - 1] !== '(' &&
          this.comparePriority(current, outputStack[outputStack.length - 1])) {
          const popValue: string | undefined = outputStack.pop();
          if (popValue !== undefined) {
            outputQueue.push(popValue);
          }
        }
        outputStack.push(current);
      } else {
        // Processing the numbers.
        outputQueue.push(current);
      }
    }
    while (outputStack.length > 0) {
      const popValue: string | undefined = outputStack.pop();
      if (popValue !== undefined && popValue !== '(') {
        outputQueue.push(popValue);
      }
    }
    return this.dealQueue(outputQueue, angleMode);
  }

  /**
   * Processing expressions in queues.
   *
   * @param queue Expression Queue.
   * @return The end result.
   */
  dealQueue(queue: Array<string>, angleMode?: string): string {
    if (CheckEmptyUtil.isEmpty(queue)) {
      return 'NaN';
    }
    let outputStack: string[] = [];
    while (queue.length > 0) {
      let current: string | undefined = queue.shift();
      if (current !== undefined) {
        if (this.isFunction(current)) {
          const operand: string | undefined = outputStack.pop();
          if (operand === undefined) {
            return 'NaN';
          }
          const funcResult: string = this.applyFunction(operand, current, angleMode);
          if (funcResult === 'NaN') {
            return 'NaN';
          }
          outputStack.push(funcResult);
        } else if (!this.isSymbol(current)) {
          outputStack.push(current);
        } else {
          let second: string | undefined = outputStack.pop();
          let first: string | undefined = outputStack.pop();
          if (first !== undefined && second !== undefined) {
            let calResultValue: string = this.calResult(first, second, current);
            outputStack.push(calResultValue);
          }
        }
      }
    }
    if (outputStack.length !== 1) {
      return 'NaN';
    } else {
      let end: string = outputStack[0]?.endsWith(CommonConstants.DOTS) ?
        outputStack[0].substring(0, outputStack[0].length - 1) : outputStack[0];
      return end;
    }
  }

  /**
   * Calculation result.
   *
   * @param arg1 Number 1.
   * @param arg2 Number 2.
   * @param symbol Operators.
   * @return Calculation result.
   */
  calResult(arg1: string, arg2: string, symbol: string): string {
    if (CheckEmptyUtil.isEmpty(arg1) || CheckEmptyUtil.isEmpty(arg2) || CheckEmptyUtil.isEmpty(symbol)) {
      return 'NaN';
    }
    let result = 0;
    switch (symbol) {
      case SymbolicEnumeration.ADD:
        result = this.add(arg1, arg2, CommonConstants.ADD);
        break;
      case SymbolicEnumeration.MIN:
        result = this.add(arg1, arg2, CommonConstants.MIN);
        break;
      case SymbolicEnumeration.MUL:
        result = this.mulOrDiv(arg1, arg2, CommonConstants.MUL);
        break;
      case SymbolicEnumeration.DIV:
        result = this.mulOrDiv(arg1, arg2, CommonConstants.DIV);
        break;
      default:
        break;
    }
    return this.numberToScientificNotation(result);
  }

  /**
   * Addition and subtraction operation.
   *
   * @param arg1 Number 1.
   * @param arg2 Number 2.
   * @param symbol Operators.
   * @return Addition and subtraction results.
   */
  add(arg1: string, arg2: string, symbol: string): number {
    let addFlag = (symbol === CommonConstants.ADD);
    if (this.containScientificNotation(arg1) || this.containScientificNotation(arg2)) {
      if (addFlag) {
        return Number(arg1) + Number(arg2);
      }
      return Number(arg1) - Number(arg2);
    }
    arg1 = (arg1 === CommonConstants.ZERO_DOTS) ? '0' : arg1;
    arg2 = (arg2 === CommonConstants.ZERO_DOTS) ? '0' : arg2;
    let leftArr = arg1.split(CommonConstants.DOTS);
    let rightArr = arg2.split(CommonConstants.DOTS);
    let leftLen = leftArr.length > 1 ? leftArr[1] : '';
    let rightLen = rightArr.length > 1 ? rightArr[1] : '';
    let maxLen = Math.max(leftLen.length, rightLen.length);
    let multiples = Math.pow(CommonConstants.TEN, maxLen);
    if (addFlag) {
      return Number(((Number(arg1) * multiples + Number(arg2) * multiples) / multiples).toFixed(maxLen));
    }
    return Number(((Number(arg1) * multiples - Number(arg2) * multiples) / multiples).toFixed(maxLen));
  }

  /**
   * multiplication and division operation.
   *
   * @param arg1 Number 1.
   * @param arg2 Number 2.
   * @param symbol Operators.
   * @return Multiply and divide result.
   */
  mulOrDiv(arg1: string, arg2: string, symbol: string): number {
    let mulFlag = (symbol === CommonConstants.MUL);
    if (this.containScientificNotation(arg1) || this.containScientificNotation(arg2)) {
      if (mulFlag) {
        return Number(arg1) * Number(arg2);
      }
      return Number(arg1) / Number(arg2);
    }
    let leftLen = arg1.split(CommonConstants.DOTS)[1] ? arg1.split(CommonConstants.DOTS)[1].length : 0;
    let rightLen = arg2.split(CommonConstants.DOTS)[1] ? arg2.split(CommonConstants.DOTS)[1].length : 0;
    if (mulFlag) {
      return Number(arg1.replace(CommonConstants.DOTS, '')) *
      Number(arg2.replace(CommonConstants.DOTS, '')) / Math.pow(CommonConstants.TEN, leftLen + rightLen);
    }
    return Number(arg1.replace(CommonConstants.DOTS, '')) /
      (Number(arg2.replace(CommonConstants.DOTS, '')) / Math.pow(CommonConstants.TEN, rightLen - leftLen));
  }

  /**
   * Whether the operand contains scientific notation
   *
   * @param arg Number.
   * @return Whether scientific notation is included
   */
  containScientificNotation(arg: string) {
    return (arg.indexOf(CommonConstants.E) !== -1);
  }

  /**
   * Results converted to scientific notation.
   *
   * @param result Digital Results.
   */
  numberToScientificNotation(result: number) {
    if (result === Number.NEGATIVE_INFINITY || result === Number.POSITIVE_INFINITY) {
      return 'NaN';
    }
    let resultStr = JSON.stringify(result);
    if (this.containScientificNotation(resultStr)) {
      return resultStr;
    }
    let prefixNumber = (resultStr.indexOf(CommonConstants.MIN) === -1) ? 1 : -1;
    result *= prefixNumber;
    if (resultStr.replace(CommonConstants.DOTS, '').replace(CommonConstants.MIN, '').length <
    CommonConstants.NUM_MAX_LEN) {
      return resultStr;
    }
    let suffix = (Math.floor(Math.log(result) / Math.LN10));
    let prefix = (result * Math.pow(CommonConstants.TEN, -suffix) * prefixNumber);
    return (prefix + CommonConstants.E + suffix);
  }

  /**
   * Apply a unary scientific function to a single numeric input string.
   * Supported ops:
   *   sin, cos, tan, asin, acos, atan, log, ln, exp, sqrt, cbrt,
   *   square, cube, inv (reciprocal), neg (negate), abs, fact (factorial)
   *
   * Returns a plain decimal string on success, or 'NaN' on failure.
   * Angles for sin/cos/tan/asin/acos/atan are in radians.
   */
  applyFunction(input: string, op: string, angleMode?: string): string {
    if (CheckEmptyUtil.isEmpty(input) || CheckEmptyUtil.isEmpty(op)) {
      return 'NaN';
    }
    const n: number = Number(input);
    if (Number.isNaN(n)) {
      return 'NaN';
    }
    const useDeg: boolean = angleMode === 'deg';
    let r: number = NaN;
    switch (op) {
      case 'sin': r = Math.sin(useDeg ? n * Math.PI / 180 : n); break;
      case 'cos': r = Math.cos(useDeg ? n * Math.PI / 180 : n); break;
      case 'tan': r = Math.tan(useDeg ? n * Math.PI / 180 : n); break;
      case 'asin': r = useDeg ? Math.asin(n) * 180 / Math.PI : Math.asin(n); break;
      case 'acos': r = useDeg ? Math.acos(n) * 180 / Math.PI : Math.acos(n); break;
      case 'atan': r = useDeg ? Math.atan(n) * 180 / Math.PI : Math.atan(n); break;
      case 'log': r = Math.log10(n); break;
      case 'pow10': r = Math.pow(10, n); break;
      case 'ln': r = Math.log(n); break;
      case 'exp': r = Math.exp(n); break;
      case 'sqrt': r = Math.sqrt(n); break;
      case 'cbrt': r = Math.cbrt ? Math.cbrt(n) : Math.pow(n, 1 / 3); break;
      case 'square': r = n * n; break;
      case 'cube': r = n * n * n; break;
      case 'inv': r = 1 / n; break;
      case 'neg': r = -n; break;
      case 'abs': r = Math.abs(n); break;
      case 'fact': r = CalculateUtil.factorial(n); break;
      default: r = NaN; break;
    }
    if (!isFinite(r) || isNaN(r)) {
      return 'NaN';
    }
    r = CalculateUtil.roundSignificant(r, 12);
    return this.numberToScientificNotation(r);
  }

  /**
   * Iterative factorial for non-negative integers. Returns NaN on
   * non-integer or negative input; returns Infinity on overflow.
   */
  private static factorial(n: number): number {
    if (n < 0 || !Number.isInteger(n)) {
      return NaN;
    }
    let result: number = 1;
    for (let i: number = 2; i <= n; i++) {
      result *= i;
      if (!isFinite(result)) {
        return Number.POSITIVE_INFINITY;
      }
    }
    return result;
  }

  /**
   * Apply a binary power operation: base ^ exponent (or n-th root when
   * exponent is a unit fraction, e.g. 1/3 -> cube root).
   */
  applyPow(base: string, exponent: string): string {
    if (CheckEmptyUtil.isEmpty(base) || CheckEmptyUtil.isEmpty(exponent)) {
      return 'NaN';
    }
    const b: number = Number(base);
    const e: number = Number(exponent);
    if (Number.isNaN(b) || Number.isNaN(e)) {
      return 'NaN';
    }
    const r: number = Math.pow(b, e);
    if (!isFinite(r)) {
      return 'NaN';
    }
    const rounded: number = CalculateUtil.roundSignificant(r, 12);
    return this.numberToScientificNotation(rounded);
  }

  /**
   * Format a number with at most `maxFractionDigits` digits after the decimal
   * point, trimmed of trailing zeros. Used by scientific calculator buttons
   * like π / e that insert a long constant but don't fill the screen.
   */
  formatNumber(value: number, maxFractionDigits: number): string {
    if (!isFinite(value) || Number.isNaN(value)) {
      return 'NaN';
    }
    let s: string = value.toFixed(maxFractionDigits);
    if (s.indexOf('.') !== -1) {
      s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return s;
  }
}

export default new CalculateUtil();