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

import { CommonConstants } from '../common/constants/CommonConstants';
import { CurrencyConverterUtil, CurrencyDef } from '../common/util/CurrencyConverterUtil';
import { buildNavMenu } from '../common/util/NavMenu';

@Entry
@Component
struct CurrencyConverterPage {
  @State fromIndex: number = 1;
  @State toIndex: number = 0;
  @State inputValue: string = '';

  uiContext = this.getUIContext();
  @StorageLink('topRectHeight') topRectHeight: number = 0;
  @StorageLink('bottomRectHeight') bottomRectHeight: number = 0;

  private readonly keyRows: string[][] = [
    ['7', '8', '9', '⌫'],
    ['4', '5', '6', 'C'],
    ['1', '2', '3', '.']
  ];

  build() {
    Column() {
      // ===== Top bar. =====
      Row() {
        Text($r('app.string.function_currency'))
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor('rgba(0, 0, 0, 0.9)')
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .maxLines(1)
          .layoutWeight(1);
        Text('☰')
          .fontSize(20)
          .fontColor('rgba(0, 0, 0, 0.85)')
          .width(36)
          .height(36)
          .textAlign(TextAlign.Center)
          .borderRadius(18)
          .backgroundColor('rgba(0, 0, 0, 0.04)')
          .bindMenu(buildNavMenu('currency'));
      }
      .width('100%')
      .padding({ left: 16, right: 12, top: 6, bottom: 4 })
      .margin({ top: this.uiContext.px2vp(this.topRectHeight) })
      .alignItems(VerticalAlign.Center);

      // ===== From / To currency selectors. =====
      Row() {
        Text(this.currencies()[this.fromIndex].label)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(Color.Black)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .textAlign(TextAlign.Center)
          .layoutWeight(1)
          .height(44)
          .borderRadius(40)
          .backgroundColor('rgb(255, 255, 255)')
          .bindMenu(this.buildCurrencyMenu('from'));

        Text('⇄')
          .fontSize(18)
          .fontColor('rgba(0, 0, 0, 0.55)')
          .margin({ left: 10, right: 10 });

        Text(this.currencies()[this.toIndex].label)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(Color.Black)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .textAlign(TextAlign.Center)
          .layoutWeight(1)
          .height(44)
          .borderRadius(40)
          .backgroundColor('rgb(255, 255, 255)')
          .bindMenu(this.buildCurrencyMenu('to'));
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 16, bottom: 6 });

      // ===== Display: input + result. =====
      Column() {
        Text(this.inputValue.length === 0 ? '0' : this.inputValue)
          .fontSize(36)
          .fontColor(Color.Black)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .width('100%')
          .textAlign(TextAlign.End)
          .lineHeight(44)
          .maxLines(1);

        Text(`${this.currencies()[this.fromIndex].code} ${this.currencies()[this.fromIndex].label}`)
          .fontSize(14)
          .fontColor('rgba(0, 0, 0, 0.55)')
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .width('100%')
          .textAlign(TextAlign.End)
          .margin({ top: 4 });

        Text(`= ${this.result()} ${this.currencies()[this.toIndex].code}`)
          .fontSize(22)
          .fontWeight(FontWeight.Medium)
          .fontColor(Color.Black)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .width('100%')
          .textAlign(TextAlign.End)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: 8 });

        Text('汇率仅供参考（静态）')
          .fontSize(12)
          .fontColor('rgba(0, 0, 0, 0.4)')
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .width('100%')
          .textAlign(TextAlign.End)
          .margin({ top: 8 });
      }
      .width('100%')
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.End)
      .padding({ left: 16, right: 16, top: 4, bottom: 8 });

      // ===== Numeric keyboard. =====
      Column() {
        ForEach(this.keyRows, (row: string[], rowIndex: number) => {
          Row() {
            ForEach(row, (key: string, colIndex: number) => {
              Text(key)
                .fontSize(key === '⌫' || key === 'C' ? 22 : 24)
                .fontWeight(FontWeight.Medium)
                .fontColor(Color.Black)
                .fontFamily(CommonConstants.FONT_FAMILY_1)
                .textAlign(TextAlign.Center)
                .layoutWeight(1)
                .height('100%')
                .margin({ left: 4, right: 4, top: 8, bottom: 8 })
                .borderRadius(40)
                .backgroundColor(key === '⌫' || key === 'C' ? '#E5E5EA' : 'rgb(255, 255, 255)')
                .onClick(() => {
                  this.onKey(key);
                });
            }, (key: string, colIndex: number) => `ckey_${rowIndex}_${colIndex}`);
          }
          .layoutWeight(1)
          .width('100%');
        }, (row: string[], rowIndex: number) => `crow_${rowIndex}`);

        // Full-width 0 key.
        Row() {
          Text('0')
            .fontSize(24)
            .fontWeight(FontWeight.Medium)
            .fontColor(Color.Black)
            .fontFamily(CommonConstants.FONT_FAMILY_1)
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .height('100%')
            .margin({ left: 4, right: 4, top: 8, bottom: 8 })
            .borderRadius(40)
            .backgroundColor('rgb(255, 255, 255)')
            .onClick(() => {
              this.onKey('0');
            });
        }
        .width('100%')
        .layoutWeight(1);
      }
      .layoutWeight(2)
      .width('100%')
      .padding({
        left: 8,
        right: 8,
        top: 4,
        bottom: this.uiContext.px2vp(this.bottomRectHeight) + 4
      })
      .backgroundColor(Color.Transparent);
    }
    .width('100%')
    .height(CommonConstants.FULL_PERCENT)
    .backgroundColor($r('app.color.all_back_color'));
  }

  private currencies(): CurrencyDef[] {
    return CurrencyConverterUtil.getCurrencies();
  }

  private buildCurrencyMenu(target: string): Array<MenuElement> {
    const list: CurrencyDef[] = this.currencies();
    const result: Array<MenuElement> = [];
    list.forEach((currency: CurrencyDef, index: number) => {
      const current: number = target === 'from' ? this.fromIndex : this.toIndex;
      const label: string = index === current ? `${currency.label} (${currency.code})  ✓` : `${currency.label} (${currency.code})`;
      const item: MenuElement = {
        value: label,
        action: (): void => {
          if (target === 'from') {
            this.fromIndex = index;
          } else {
            this.toIndex = index;
          }
        }
      };
      result.push(item);
    });
    return result;
  }

  private result(): string {
    const value: number = Number(this.inputValue);
    if (this.inputValue.length === 0 || Number.isNaN(value)) {
      return '0';
    }
    const from: CurrencyDef = this.currencies()[this.fromIndex];
    const to: CurrencyDef = this.currencies()[this.toIndex];
    return CurrencyConverterUtil.formatResult(CurrencyConverterUtil.convert(value, from, to));
  }

  private onKey(key: string): void {
    if (key === '⌫') {
      if (this.inputValue.length > 0) {
        this.inputValue = this.inputValue.substring(0, this.inputValue.length - 1);
      }
      return;
    }
    if (key === 'C') {
      this.inputValue = '';
      return;
    }
    if (key === '.') {
      if (this.inputValue.indexOf('.') === -1) {
        this.inputValue = this.inputValue.length === 0 ? '0.' : this.inputValue + '.';
      }
      return;
    }
    if (this.inputValue === '0') {
      this.inputValue = key;
    } else if (this.inputValue.length < 16) {
      this.inputValue = this.inputValue + key;
    }
  }
}
