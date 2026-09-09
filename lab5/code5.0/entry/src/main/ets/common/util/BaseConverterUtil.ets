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
 * Base (radix) conversion helpers. Supports binary (2), octal (8),
 * decimal (10) and hexadecimal (16).
 */
export class BaseConverterUtil {
  static readonly BASE_DIGITS: string = '0123456789ABCDEF';

  /**
   * Whether a digit is valid for the given base.
   */
  static isValidDigit(digit: string, base: number): boolean {
    if (digit.length !== 1) {
      return false;
    }
    const index: number = BaseConverterUtil.BASE_DIGITS.indexOf(digit.toUpperCase());
    return index >= 0 && index < base;
  }

  /**
   * Convert a string in `fromBase` to a decimal string.
   * Returns '' on invalid input.
   */
  static toDecimal(input: string, fromBase: number): string {
    if (input.length === 0) {
      return '';
    }
    const digits: string = input.toUpperCase();
    let value: number = 0;
    for (let i: number = 0; i < digits.length; i++) {
      const index: number = BaseConverterUtil.BASE_DIGITS.indexOf(digits.charAt(i));
      if (index < 0 || index >= fromBase) {
        return '';
      }
      value = value * fromBase + index;
    }
    return value.toString();
  }

  /**
   * Convert a decimal string to a string in `toBase`.
   * Returns '' on invalid input.
   */
  static fromDecimal(decimal: string, toBase: number): string {
    if (decimal.length === 0) {
      return '';
    }
    let num: number = Number(decimal);
    if (!Number.isFinite(num) || num < 0 || Math.floor(num) !== num) {
      return '';
    }
    if (num === 0) {
      return '0';
    }
    let result: string = '';
    while (num > 0) {
      result = BaseConverterUtil.BASE_DIGITS.charAt(num % toBase) + result;
      num = Math.floor(num / toBase);
    }
    return result;
  }

  /**
   * Convert `input` from `fromBase` to `toBase`.
   */
  static convert(input: string, fromBase: number, toBase: number): string {
    const decimal: string = BaseConverterUtil.toDecimal(input, fromBase);
    if (decimal === '') {
      return '';
    }
    return BaseConverterUtil.fromDecimal(decimal, toBase);
  }
}
