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
 * A unit within a conversion category. `factor` and `offset` describe an
 * affine mapping to the category's base unit:
 *
 *   baseValue = value * factor + offset
 *   value     = (baseValue - offset) / factor
 *
 * Linear units (length, weight, area, volume, speed, data) only use `factor`.
 * Temperature uses both `factor` and `offset` so Celsius/Fahrenheit/Kelvin
 * convert correctly.
 */
export class UnitDef {
  label: string;
  factor: number;
  offset: number;

  constructor(label: string, factor: number, offset: number = 0) {
    this.label = label;
    this.factor = factor;
    this.offset = offset;
  }
}

export class UnitConverterUtil {
  static readonly CATEGORIES: string[] =
    ['长度', '重量', '面积', '体积', '温度', '速度', '数据'];

  /**
   * Return the units for a category.
   */
  static getUnits(category: string): UnitDef[] {
    switch (category) {
      case '长度':
        return [
          new UnitDef('米', 1),
          new UnitDef('千米', 1000),
          new UnitDef('厘米', 0.01),
          new UnitDef('毫米', 0.001),
          new UnitDef('英里', 1609.344),
          new UnitDef('英尺', 0.3048),
          new UnitDef('英寸', 0.0254),
          new UnitDef('码', 0.9144)
        ];
      case '重量':
        return [
          new UnitDef('千克', 1),
          new UnitDef('克', 0.001),
          new UnitDef('毫克', 0.000001),
          new UnitDef('吨', 1000),
          new UnitDef('磅', 0.45359237),
          new UnitDef('盎司', 0.028349523)
        ];
      case '面积':
        return [
          new UnitDef('平方米', 1),
          new UnitDef('平方千米', 1000000),
          new UnitDef('公顷', 10000),
          new UnitDef('亩', 666.6667),
          new UnitDef('平方英尺', 0.092903)
        ];
      case '体积':
        return [
          new UnitDef('升', 1),
          new UnitDef('毫升', 0.001),
          new UnitDef('立方米', 1000),
          new UnitDef('加仑(美)', 3.785411784)
        ];
      case '温度':
        return [
          new UnitDef('摄氏度', 1, 0),
          new UnitDef('华氏度', 5 / 9, -160 / 9),
          new UnitDef('开尔文', 1, -273.15)
        ];
      case '速度':
        return [
          new UnitDef('米/秒', 1),
          new UnitDef('千米/时', 0.27777778),
          new UnitDef('英里/时', 0.44704),
          new UnitDef('节', 0.514444)
        ];
      case '数据':
        return [
          new UnitDef('字节', 1),
          new UnitDef('千字节', 1024),
          new UnitDef('兆字节', 1048576),
          new UnitDef('吉字节', 1073741824),
          new UnitDef('太字节', 1099511627776)
        ];
      default:
        return [new UnitDef('米', 1), new UnitDef('千米', 1000)];
    }
  }

  /**
   * Convert a numeric value from one unit to another within the same category.
   */
  static convert(value: number, from: UnitDef, to: UnitDef): number {
    const base: number = value * from.factor + from.offset;
    return (base - to.offset) / to.factor;
  }

  /**
   * Format a conversion result: trim trailing zeros, keep reasonable precision.
   */
  static formatResult(value: number): string {
    if (!Number.isFinite(value)) {
      return '0';
    }
    if (value === 0) {
      return '0';
    }
    const abs: number = Math.abs(value);
    let s: string;
    if (abs >= 1e9 || abs < 1e-6) {
      s = value.toExponential(6);
    } else {
      s = value.toFixed(10);
      if (s.indexOf('.') !== -1) {
        s = s.replace(/0+$/, '').replace(/\.$/, '');
      }
    }
    return s;
  }
}
