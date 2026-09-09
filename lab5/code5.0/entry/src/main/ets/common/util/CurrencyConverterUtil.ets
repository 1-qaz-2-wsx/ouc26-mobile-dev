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
 * A supported currency. `rate` is the approximate value of one unit in CNY.
 */
export class CurrencyDef {
  code: string;
  label: string;
  rate: number;

  constructor(code: string, label: string, rate: number) {
    this.code = code;
    this.label = label;
    this.rate = rate;
  }
}

/**
 * Currency conversion using a static, approximate exchange-rate table
 * (relative to CNY). For a demo; real apps should fetch live rates.
 */
export class CurrencyConverterUtil {
  static getCurrencies(): CurrencyDef[] {
    return [
      new CurrencyDef('CNY', '人民币', 1),
      new CurrencyDef('USD', '美元', 7.20),
      new CurrencyDef('EUR', '欧元', 7.80),
      new CurrencyDef('JPY', '日元', 0.049),
      new CurrencyDef('GBP', '英镑', 9.10),
      new CurrencyDef('HKD', '港币', 0.92),
      new CurrencyDef('KRW', '韩元', 0.0052),
      new CurrencyDef('AUD', '澳元', 4.70)
    ];
  }

  /**
   * Convert a value from one currency to another.
   */
  static convert(value: number, from: CurrencyDef, to: CurrencyDef): number {
    return value * from.rate / to.rate;
  }

  /**
   * Format a currency result with up to 4 decimal places.
   */
  static formatResult(value: number): string {
    if (!Number.isFinite(value)) {
      return '0';
    }
    if (value === 0) {
      return '0';
    }
    let s: string = value.toFixed(4);
    if (s.indexOf('.') !== -1) {
      s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return s;
  }
}
