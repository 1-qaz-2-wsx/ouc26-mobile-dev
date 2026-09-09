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
import { UnitConverterUtil, UnitDef } from '../common/util/UnitConverterUtil';
import { buildNavMenu } from '../common/util/NavMenu';

@Entry
@Component
struct UnitConverterPage {
  @State categoryIndex: number = 0;
  @State fromIndex: number = 0;
  @State toIndex: number = 1;
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
        Text($r('app.string.function_unit'))
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
          .bindMenu(buildNavMenu('unit'));
      }
      .width('100%')
      .padding({ left: 16, right: 12, top: 6, bottom: 4 })
      .margin({ top: this.uiContext.px2vp(this.topRectHeight) })
      .alignItems(VerticalAlign.Center);

      // ===== Category selector (horizontal scroll). =====
      Scroll() {
        Row() {
          ForEach(UnitConverterUtil.CATEGORIES, (category: string, index: number) => {
            Text(category)
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.categoryIndex === index ? Color.White : 'rgba(0, 0, 0, 0.75)')
              .fontFamily(CommonConstants.FONT_FAMILY_1)
              .textAlign(TextAlign.Center)
              .height(36)
              .padding({ left: 16, right: 16 })
              .borderRadius(40)
              .backgroundColor(this.categoryIndex === index ? '#FF9500' : 'rgb(255, 255, 255)')
              .margin({ right: 8 })
              .onClick(() => {
                this.selectCategory(index);
              });
          }, (category: string) => `cat_${category}`);
        }
        .padding({ left: 12, right: 12 });
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      .margin({ top: 6, bottom: 6 });

      // ===== From / To unit selectors. =====
      Row() {
        Text(this.getUnits()[this.fromIndex].label)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(Color.Black)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .textAlign(TextAlign.Center)
          .layoutWeight(1)
          .height(44)
          .borderRadius(40)
          .backgroundColor('rgb(255, 255, 255)')
          .bindMenu(this.buildUnitMenu('from'));

        Text('⇄')
          .fontSize(18)
          .fontColor('rgba(0, 0, 0, 0.55)')
          .margin({ left: 10, right: 10 });

        Text(this.getUnits()[this.toIndex].label)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(Color.Black)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .textAlign(TextAlign.Center)
          .layoutWeight(1)
          .height(44)
          .borderRadius(40)
          .backgroundColor('rgb(255, 255, 255)')
          .bindMenu(this.buildUnitMenu('to'));
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 6, bottom: 6 });

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

        Text(this.getUnits()[this.fromIndex].label)
          .fontSize(14)
          .fontColor('rgba(0, 0, 0, 0.55)')
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .width('100%')
          .textAlign(TextAlign.End)
          .margin({ top: 4 });

        Text(`= ${this.result()} ${this.getUnits()[this.toIndex].label}`)
          .fontSize(22)
          .fontWeight(FontWeight.Medium)
          .fontColor(Color.Black)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .width('100%')
          .textAlign(TextAlign.End)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
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
            }, (key: string, colIndex: number) => `key_${rowIndex}_${colIndex}`);
          }
          .layoutWeight(1)
          .width('100%');
        }, (row: string[], rowIndex: number) => `urow_${rowIndex}`);

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

  private getUnits(): UnitDef[] {
    return UnitConverterUtil.getUnits(UnitConverterUtil.CATEGORIES[this.categoryIndex]);
  }

  private buildUnitMenu(target: string): Array<MenuElement> {
    const units: UnitDef[] = this.getUnits();
    const result: Array<MenuElement> = [];
    units.forEach((unit: UnitDef, index: number) => {
      const current: number = target === 'from' ? this.fromIndex : this.toIndex;
      const label: string = index === current ? `${unit.label}  ✓` : unit.label;
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

  private selectCategory(index: number): void {
    if (this.categoryIndex === index) {
      return;
    }
    this.categoryIndex = index;
    this.fromIndex = 0;
    this.toIndex = this.getUnits().length > 1 ? 1 : 0;
  }

  private result(): string {
    const value: number = Number(this.inputValue);
    if (this.inputValue.length === 0 || Number.isNaN(value)) {
      return '0';
    }
    const units: UnitDef[] = this.getUnits();
    const from: UnitDef = units[this.fromIndex];
    const to: UnitDef = units[this.toIndex];
    return UnitConverterUtil.formatResult(UnitConverterUtil.convert(value, from, to));
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
    // Digit.
    if (this.inputValue === '0') {
      this.inputValue = key;
    } else if (this.inputValue.length < 16) {
      this.inputValue = this.inputValue + key;
    }
  }
}
