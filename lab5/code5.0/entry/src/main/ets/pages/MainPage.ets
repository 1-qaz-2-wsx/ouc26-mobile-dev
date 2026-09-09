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

import Logger from '../common/util/Logger';
import CalculateUtil from '../common/util/CalculateUtil';
import CheckEmptyUtil from '../common/util/CheckEmptyUtil';
import keysModel from '../viewmodel/PresskeysViewModel';
import { PressKeyItem } from '../viewmodel/PressKeysItem';
import { CommonConstants, Symbol } from '../common/constants/CommonConstants';
import { buildNavMenu } from '../common/util/NavMenu';
import { common } from '@kit.AbilityKit';

@Entry
@Component
struct MainPage {
  @State @Watch('inputValueChange') inputValue: string = '';
  @State calValue: string = '';
  private expressions: Array<string> = [];
  @State lastBtnIsEqu: boolean = false;
  uiContext = this.getUIContext();
  @StorageLink('topRectHeight') topRectHeight: number = 0;
  @StorageLink('bottomRectHeight') bottomRectHeight: number = 0;

  inputValueChange() {
    if (this.inputValue !== null || this.inputValue !== undefined) {
      this.inputValue = this.resultFormat((this.inputValue));
    }
  }

  build() {
    Column() {
      // Top bar: page title + feature menu (shows all functions, current marked ✓).
      Row() {
        Text($r('app.string.function_calculator'))
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
          .bindMenu(buildNavMenu('calculator'));
      }
      .width('100%')
      .padding({ left: 16, right: 12, top: 6, bottom: 4 })
      .margin({ top: this.uiContext.px2vp(this.topRectHeight) })
      .alignItems(VerticalAlign.Center);

      // Display area: taller -> more room for input + preview; layout never jumps.
      Column() {
        Text(this.resultFormat(this.inputValue))
          .fontSize(36)
          .fontColor(Color.Black)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .width('100%')
          .textAlign(TextAlign.End)
          .lineHeight(44)
          .maxLines(2);

        Text(this.resultFormat(this.calValue))
          .fontSize(20)
          .fontWeight(CommonConstants.FONT_WEIGHT_MEDIUM)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .fontColor('rgba(0, 0, 0, 0.55)')
          .width('100%')
          .textAlign(TextAlign.End)
          .margin({ top: 6 })
          .lineHeight(26)
          .maxLines(1);
      }
      .width('100%')
      .height(164)
      .justifyContent(FlexAlign.End)
      .alignItems(HorizontalAlign.End)
      .padding({ left: 16, right: 16, top: 4, bottom: 8 });

      // Keyboard: 4 columns x 5 rows, weights-based so it adapts to any screen.
      Column() {
        ForEach(keysModel.getPressKeys(), (row: Array<PressKeyItem>, rowIndex: number) => {
          Row() {
            ForEach(row, (keyItem: PressKeyItem) => {
              Column() {
                if (keyItem.flag === 0) {
                  Image(keyItem.source !== undefined ? keyItem.source : '')
                    .width(24)
                    .height(24)
                    .objectFit(ImageFit.Contain);
                } else {
                  Text(keyItem.value)
                    .fontSize(keyItem.flag === 3 ? 30 : 24)
                    .fontColor(keyItem.flag === 3 ? Color.White : Color.Black)
                    .fontWeight(FontWeight.Medium)
                    .textAlign(TextAlign.Center);
                }
              }
              .layoutWeight(1)
              .height('100%')
              .margin({ left: 4, right: 4, top: 10, bottom: 10 })
              .borderRadius(40)
              .backgroundColor(this.keyBg(keyItem.flag))
              .alignItems(HorizontalAlign.Center)
              .justifyContent(FlexAlign.Center)
              .onClick(() => {
                this.onKeyTap(keyItem);
              });
            }, (keyItem: PressKeyItem) => `${rowIndex}_${keyItem.value}_${keyItem.flag}`);
          }
          .layoutWeight(1)
          .width('100%');
        }, (row: Array<PressKeyItem>, rowIndex: number) => `row_${rowIndex}`);
      }
      .layoutWeight(1)
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

  private keyBg(flag: number): string {
    if (flag === 3) {
      return '#FF9500'; // equals - iOS orange
    }
    if (flag === 2 || flag === 0) {
      return '#E5E5EA'; // operators / delete - light gray (iOS)
    }
    return 'rgb(255, 255, 255)'; // digits - white
  }

  private onKeyTap(keyItem: PressKeyItem): void {
    if (keyItem.flag === 4) {
      this.negateLast();
      return;
    }
    if (keyItem.flag === 1) {
      if (this.lastBtnIsEqu) {
        this.expressions = [];
      }
      this.lastBtnIsEqu = false;
      this.inputNumber(keyItem.value);
      return;
    }
    this.inputSymbol(keyItem.value);
  }

  /**
   * Toggle the sign of the most recent number token (± key).
   */
  private negateLast(): void {
    const len: number = this.expressions.length;
    if (len === 0) {
      return;
    }
    const last: string = this.expressions[len - 1];
    if (CalculateUtil.isSymbol(last)) {
      return;
    }
    if (last.startsWith('-')) {
      this.expressions[len - 1] = last.substring(1);
    } else {
      this.expressions[len - 1] = '-' + last;
    }
    this.lastBtnIsEqu = false;
    this.formatInputValue();
    this.getResult();
  }

  inputSymbol(value: string) {
    if (CheckEmptyUtil.isEmpty(value)) {
      return;
    }
    let len = this.expressions.length;
    this.lastBtnIsEqu = false;
    switch (value) {
      case Symbol.CLEAN:
        this.expressions = [];
        this.calValue = '';
        break;
      case Symbol.DEL:
        this.inputDelete(len);
        break;
      case Symbol.EQU:
        if (len === 0) {
          return;
        }
        this.getResult().then((result: boolean) => {
          if (!result) {
            return;
          }
          this.inputValue = this.calValue;
          this.calValue = '';
          this.expressions = [];
          this.expressions.push(this.inputValue);
          this.lastBtnIsEqu = true;
        });
        break;
      default:
        this.inputOperators(len, value);
        break;
    }
    this.formatInputValue();
  }

  inputNumber(value: string) {
    if (CheckEmptyUtil.isEmpty(value)) {
      return;
    }
    let len = this.expressions.length;
    let last = len > 0 ? this.expressions[len - 1] : '';
    let secondLast = len > 1 ? this.expressions[len - CommonConstants.TWO] : undefined;
    if (!this.validateEnter(last, value)) {
      return;
    }
    if (!last) {
      this.expressions.push(value);
    } else if (!secondLast) {
      this.expressions[len - 1] += value;
    }
    if (secondLast && CalculateUtil.isSymbol(secondLast)) {
      this.expressions[len - 1] += value;
    }
    if (secondLast && !CalculateUtil.isSymbol(secondLast)) {
      this.expressions.push(value);
    }
    this.formatInputValue();
    if (value !== CommonConstants.DOTS) {
      this.getResult();
    }
  }

  validateEnter(last: string, value: string) {
    if (!last && value === CommonConstants.PERCENT_SIGN) {
      return false;
    }
    if ((last === CommonConstants.MIN) && (value === CommonConstants.PERCENT_SIGN)) {
      return false;
    }
    if (last.endsWith(CommonConstants.PERCENT_SIGN)) {
      return false;
    }
    if ((last.indexOf(CommonConstants.DOTS) !== -1) && (value === CommonConstants.DOTS)) {
      return false;
    }
    if ((last === '0') && (value !== CommonConstants.DOTS) &&
      (value !== CommonConstants.PERCENT_SIGN)) {
      return false;
    }
    return true;
  }

  inputDelete(len: number) {
    if (len === 0) {
      return;
    }
    let last = this.expressions[len - 1];
    let lastLen = last.length;
    if (lastLen === 1) {
      this.expressions.pop();
      len = this.expressions.length;
    } else {
      this.expressions[len - 1] = last.slice(0, last.length - 1);
    }
    if (len === 0) {
      this.inputValue = '';
      this.calValue = '';
      return;
    }
    if (!CalculateUtil.isSymbol(this.expressions[len - 1])) {
      this.getResult();
    }
  }

  inputOperators(len: number, value: string) {
    let last = len > 0 ? this.expressions[len - 1] : undefined;
    let secondLast = len > 1 ? this.expressions[len - CommonConstants.TWO] : undefined;
    if (!last && (value === Symbol.MIN)) {
      this.expressions.push(this.getSymbol(value));
      return;
    }
    if (!last) {
      return;
    }
    if (!CalculateUtil.isSymbol(last)) {
      this.expressions.push(this.getSymbol(value));
      return;
    }
    if ((value === Symbol.MIN) &&
      (last === CommonConstants.MIN || last === CommonConstants.ADD)) {
      this.expressions.pop();
      this.expressions.push(this.getSymbol(value));
      return;
    }
    if (!secondLast) {
      return;
    }
    if (value !== Symbol.MIN) {
      this.expressions.pop();
    }
    if (CalculateUtil.isSymbol(secondLast)) {
      this.expressions.pop();
    }
    this.expressions.push(this.getSymbol(value));
  }

  getSymbol(value: string) {
    if (CheckEmptyUtil.isEmpty(value)) {
      return '';
    }
    let symbol = '';
    switch (value) {
      case Symbol.ADD: symbol = CommonConstants.ADD; break;
      case Symbol.MIN: symbol = CommonConstants.MIN; break;
      case Symbol.MUL: symbol = CommonConstants.MUL; break;
      case Symbol.DIV: symbol = CommonConstants.DIV; break;
      default: break;
    }
    return symbol;
  }

  deepCopy(): Array<string> {
    let copyExpressions: Array<string> = Array.from(this.expressions);
    return copyExpressions;
  }

  async getResult() {
    let calResult = CalculateUtil.parseExpression(this.deepCopy());
    if (calResult === 'NaN') {
      this.calValue = this.resourceToString($r('app.string.error'));
      return false;
    }
    this.calValue = calResult;
    return true;
  }

  resultFormat(value: string) {
    let reg = (value.indexOf('.') > -1) ? /(\d)(?=(\d{3})+\.)/g : /(\d)(?=(?:\d{3})+$)/g;
    return value.replace(reg, '$1,');
  }

  resourceToString(resource: Resource): string {
    let result = '';
    try {
      result = (this.uiContext.getHostContext() as common.UIAbilityContext).resourceManager.getStringSync(resource.id);
    } catch (error) {
      Logger.error('[MainPage] getResourceString fail: ' + JSON.stringify(error));
    }
    return result;
  }

  formatInputValue() {
    let deepExpressions: Array<string> = [];
    this.deepCopy().forEach((item: string, index: number) => {
      deepExpressions[index] = this.resultFormat(item);
    });
    this.inputValue = deepExpressions.join('');
  }
}
