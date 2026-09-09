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
import { BaseConverterUtil } from '../common/util/BaseConverterUtil';
import { buildNavMenu } from '../common/util/NavMenu';

const BASE_HEX: number = 16;
const BASE_DEC: number = 10;
const BASE_OCT: number = 8;
const BASE_BIN: number = 2;

@Entry
@Component
struct BaseConverterPage {
  @State inputValue: string = '';
  @State base: number = BASE_DEC;

  uiContext = this.getUIContext();
  @StorageLink('topRectHeight') topRectHeight: number = 0;
  @StorageLink('bottomRectHeight') bottomRectHeight: number = 0;

  private readonly baseLabels: string[] = ['HEX', 'DEC', 'OCT', 'BIN'];
  private readonly baseValues: number[] = [BASE_HEX, BASE_DEC, BASE_OCT, BASE_BIN];
  private readonly hexRows: string[][] = [
    ['7', '8', '9', 'A'],
    ['4', '5', '6', 'B'],
    ['1', '2', '3', 'C'],
    ['0', 'F', 'E', 'D']
  ];

  build() {
    Column() {
      // ===== Top bar: title + feature menu. =====
      Row() {
        Text($r('app.string.function_base'))
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
          .bindMenu(buildNavMenu('base'));
      }
      .width('100%')
      .padding({ left: 16, right: 12, top: 6, bottom: 4 })
      .margin({ top: this.uiContext.px2vp(this.topRectHeight) })
      .alignItems(VerticalAlign.Center);

      // ===== Base selector: HEX / DEC / OCT / BIN. =====
      Row() {
        ForEach(this.baseLabels, (label: string, index: number) => {
          Text(label)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.base === this.baseValues[index] ? Color.White : 'rgba(0, 0, 0, 0.75)')
            .fontFamily(CommonConstants.FONT_FAMILY_1)
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .height(36)
            .borderRadius(40)
            .backgroundColor(this.base === this.baseValues[index] ? '#FF9500' : 'rgb(255, 255, 255)')
            .onClick(() => {
              this.selectBase(this.baseValues[index]);
            });
        }, (label: string) => `base_${label}`);
      }
      .width('100%')
      .padding({ left: 12, right: 12, top: 6, bottom: 6 })
      .margin({ left: 4, right: 4 });

      // ===== Display area: current input + all-base conversions. =====
      Column() {
        Text(this.inputValue.length === 0 ? '0' : this.inputValue)
          .fontSize(36)
          .fontColor(Color.Black)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .width('100%')
          .textAlign(TextAlign.End)
          .lineHeight(44)
          .maxLines(1);

        Text(this.currentBaseName())
          .fontSize(14)
          .fontColor('rgba(0, 0, 0, 0.55)')
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .width('100%')
          .textAlign(TextAlign.End)
          .margin({ top: 4 });

        // Conversions to the four bases.
        this.conversionLine('十六进制', this.displayInBase(BASE_HEX));
        this.conversionLine('十进制', this.displayInBase(BASE_DEC));
        this.conversionLine('八进制', this.displayInBase(BASE_OCT));
        this.conversionLine('二进制', this.displayInBase(BASE_BIN));
      }
      .width('100%')
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.End)
      .padding({ left: 16, right: 16, top: 4, bottom: 8 });

      // ===== Keyboard: hex digits + DEL / C. =====
      Column() {
        ForEach(this.hexRows, (row: string[], rowIndex: number) => {
          Row() {
            ForEach(row, (digit: string, colIndex: number) => {
              Text(digit)
                .fontSize(24)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.digitEnabled(digit) ? Color.Black : 'rgba(0, 0, 0, 0.3)')
                .fontFamily(CommonConstants.FONT_FAMILY_1)
                .textAlign(TextAlign.Center)
                .layoutWeight(1)
                .height('100%')
                .margin({ left: 4, right: 4, top: 8, bottom: 8 })
                .borderRadius(40)
                .backgroundColor(this.digitEnabled(digit) ? 'rgb(255, 255, 255)' : 'rgb(226, 226, 230)')
                .onClick(() => {
                  this.appendDigit(digit);
                });
            }, (digit: string, colIndex: number) => `digit_${rowIndex}_${colIndex}`);
          }
          .layoutWeight(1)
          .width('100%');
        }, (row: string[], rowIndex: number) => `hexrow_${rowIndex}`);

        // Bottom row: DEL and Clear.
        Row() {
          Text('⌫')
            .fontSize(22)
            .fontWeight(FontWeight.Medium)
            .fontColor(Color.Black)
            .fontFamily(CommonConstants.FONT_FAMILY_1)
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .height('100%')
            .margin({ left: 4, right: 4, top: 8, bottom: 8 })
            .borderRadius(40)
            .backgroundColor('#E5E5EA')
            .onClick(() => {
              this.backspace();
            });
          Text('C')
            .fontSize(22)
            .fontWeight(FontWeight.Medium)
            .fontColor(Color.Black)
            .fontFamily(CommonConstants.FONT_FAMILY_1)
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .height('100%')
            .margin({ left: 4, right: 4, top: 8, bottom: 8 })
            .borderRadius(40)
            .backgroundColor('#E5E5EA')
            .onClick(() => {
              this.inputValue = '';
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

  @Builder
  conversionLine(label: string, value: string) {
    Row() {
      Text(label)
        .fontSize(14)
        .fontColor('rgba(0, 0, 0, 0.55)')
        .fontFamily(CommonConstants.FONT_FAMILY_1);
      Blank();
      Text(value)
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor(Color.Black)
        .fontFamily(CommonConstants.FONT_FAMILY_1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis });
    }
    .width('100%')
    .margin({ top: 4 });
  }

  private currentBaseName(): string {
    switch (this.base) {
      case BASE_HEX: return '十六进制 HEX';
      case BASE_OCT: return '八进制 OCT';
      case BASE_BIN: return '二进制 BIN';
      default: return '十进制 DEC';
    }
  }

  private selectBase(b: number): void {
    if (this.base === b) {
      return;
    }
    // Re-interpret current input in the new base.
    const decimal: string = BaseConverterUtil.toDecimal(this.inputValue, this.base);
    if (decimal === '') {
      this.base = b;
      this.inputValue = '';
      return;
    }
    this.base = b;
    this.inputValue = BaseConverterUtil.fromDecimal(decimal, b);
  }

  private displayInBase(b: number): string {
    if (this.inputValue.length === 0) {
      return '0';
    }
    const decimal: string = BaseConverterUtil.toDecimal(this.inputValue, this.base);
    if (decimal === '') {
      return '0';
    }
    const converted: string = BaseConverterUtil.fromDecimal(decimal, b);
    return converted === '' ? '0' : converted;
  }

  private digitEnabled(digit: string): boolean {
    return BaseConverterUtil.isValidDigit(digit, this.base);
  }

  private appendDigit(digit: string): void {
    if (!this.digitEnabled(digit)) {
      return;
    }
    this.inputValue = this.inputValue + digit;
  }

  private backspace(): void {
    if (this.inputValue.length > 0) {
      this.inputValue = this.inputValue.substring(0, this.inputValue.length - 1);
    }
  }
}
