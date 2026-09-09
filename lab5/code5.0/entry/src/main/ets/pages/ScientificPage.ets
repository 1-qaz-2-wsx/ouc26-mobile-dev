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
import scientificKeys from '../viewmodel/ScientificKeyViewModel';
import { ScientificKeyItem } from '../viewmodel/ScientificKeyItem';
import { CommonConstants } from '../common/constants/CommonConstants';
import { buildNavMenu } from '../common/util/NavMenu';
import { common } from '@kit.AbilityKit';

const PI_STR: string = '3.14159265358979';
const E_STR: string = '2.71828182845905';
const ANGLE_RAD: string = 'rad';
const ANGLE_DEG: string = 'deg';

@Entry
@Component
struct ScientificPage {
  @State inputValue: string = '';
  @State calValue: string = '';
  @State invMode: boolean = false;
  @State angleMode: string = ANGLE_RAD;
  @State isErr: boolean = false;
  @State lastBtnIsEqu: boolean = false;

  private tokens: Array<string> = [];
  private currentNum: string = '';
  private pendingOp: string = ''; // '' | 'pow' | 'root'
  private pendingOperand: string = '';
  private memoryValue: string = '';
  // True after a unary function/constant/percent result: the next typed digit
  // should start a new number instead of appending to the computed result.
  private justApplied: boolean = false;

  uiContext = this.getUIContext();
  @StorageLink('topRectHeight') topRectHeight: number = 0;
  @StorageLink('bottomRectHeight') bottomRectHeight: number = 0;

  build() {
    Column() {
      // Top bar: title + Rad/Deg status + feature menu.
      Row() {
        Text($r('app.string.scientific_title'))
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor('rgba(0, 0, 0, 0.9)')
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .maxLines(1)
          .layoutWeight(1);

        Text(this.angleMode === ANGLE_RAD ? 'Rad' : 'Deg')
          .fontSize(14)
          .fontColor('rgba(0, 0, 0, 0.55)')
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .margin({ right: 8 });

        Text('☰')
          .fontSize(20)
          .fontColor('rgba(0, 0, 0, 0.85)')
          .width(36)
          .height(36)
          .textAlign(TextAlign.Center)
          .borderRadius(18)
          .backgroundColor('rgba(0, 0, 0, 0.04)')
          .bindMenu(buildNavMenu('scientific'));
      }
      .width('100%')
      .padding({ left: 16, right: 12, top: 6, bottom: 4 })
      .margin({ top: this.uiContext.px2vp(this.topRectHeight) })
      .alignItems(VerticalAlign.Center);

      // Display area: taller -> more room for input + preview; layout never jumps.
      Column() {
        Text(this.inputValue)
          .fontSize(36)
          .fontColor(this.isErr ? Color.Red : Color.Black)
          .fontFamily(CommonConstants.FONT_FAMILY_1)
          .width('100%')
          .textAlign(TextAlign.End)
          .lineHeight(44)
          .maxLines(2);
        Text(this.calValue)
          .fontSize(20)
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

      // Keyboard: 4 scientific rows (6 cols) + 5 basic rows (4 cols).
      Column() {
        // Scientific function grid.
        ForEach(scientificKeys.getFunctionKeys(), (row: Array<ScientificKeyItem>, rowIndex: number) => {
          Row() {
            ForEach(row, (item: ScientificKeyItem) => {
              Column() {
                Text(this.funcKeyLabel(item))
                  .fontSize(13)
                  .fontColor(this.funcKeyColor(item))
                  .fontWeight(FontWeight.Medium)
                  .textAlign(TextAlign.Center)
                  .maxLines(1);
              }
              .layoutWeight(1)
              .height('100%')
              .margin({ left: 3, right: 3, top: 8, bottom: 8 })
              .borderRadius(35)
              .backgroundColor(this.funcKeyBg(item))
              .alignItems(HorizontalAlign.Center)
              .justifyContent(FlexAlign.Center)
              .onClick(() => {
                this.onKeyTap(item);
              });
            }, (item: ScientificKeyItem) => `fn_${rowIndex}_${item.label}_${item.type}`);
          }
          .layoutWeight(1)
          .width('100%');
        }, (row: Array<ScientificKeyItem>, rowIndex: number) => `fnrow_${rowIndex}`);

        // Basic grid (same visual style as the basic calculator).
        ForEach(scientificKeys.getBasicKeys(), (row: Array<ScientificKeyItem>, rowIndex: number) => {
          Row() {
            ForEach(row, (item: ScientificKeyItem) => {
              Column() {
                Text(item.label)
                  .fontSize(item.type === 'eq' ? 30 : 24)
                  .fontColor(item.type === 'eq' ? Color.White : Color.Black)
                  .fontWeight(FontWeight.Medium)
                  .textAlign(TextAlign.Center);
              }
              .layoutWeight(1)
              .height('100%')
              .margin({ left: 4, right: 4, top: 10, bottom: 10 })
              .borderRadius(40)
              .backgroundColor(this.basicKeyBg(item.type))
              .alignItems(HorizontalAlign.Center)
              .justifyContent(FlexAlign.Center)
              .onClick(() => {
                this.onKeyTap(item);
              });
            }, (item: ScientificKeyItem) => `bs_${rowIndex}_${item.label}_${item.type}`);
          }
          .layoutWeight(1)
          .width('100%');
        }, (row: Array<ScientificKeyItem>, rowIndex: number) => `bsrow_${rowIndex}`);
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

  // ---------- key styling ----------

  private funcKeyLabel(item: ScientificKeyItem): string {
    if (item.type === 'angle') {
      return this.angleMode === ANGLE_RAD ? 'Rad' : 'Deg';
    }
    if (this.invMode) {
      if (item.op === 'sin') {
        return 'sin⁻¹';
      }
      if (item.op === 'cos') {
        return 'cos⁻¹';
      }
      if (item.op === 'tan') {
        return 'tan⁻¹';
      }
      if (item.op === 'ln') {
        return 'eˣ';
      }
      if (item.op === 'log') {
        return '10ˣ';
      }
    }
    return item.label;
  }

  private funcKeyColor(item: ScientificKeyItem): string {
    if (item.type === 'inv' && this.invMode) {
      return '#007DFF';
    }
    return 'rgba(0, 0, 0, 0.8)';
  }

  private funcKeyBg(item: ScientificKeyItem): string {
    if (item.type === 'inv' && this.invMode) {
      return 'rgba(0, 125, 255, 0.12)';
    }
    return 'rgb(255, 255, 255)';
  }

  private basicKeyBg(type: string): string {
    if (type === 'eq') {
      return '#FF9500';
    }
    if (type === 'op' || type === 'clear' || type === 'del') {
      return '#E5E5EA';
    }
    return 'rgb(255, 255, 255)';
  }

  // ---------- state helpers ----------

  private refresh(): void {
    let expr: string = '';
    this.tokens.forEach((t: string) => {
      if (CalculateUtil.isFunction(t)) {
        expr += this.funcDisplayName(t);
      } else {
        expr += t;
      }
    });
    if (this.pendingOp === 'pow') {
      expr += this.pendingOperand + '^';
    } else if (this.pendingOp === 'root') {
      expr += this.pendingOperand + 'ʸ√';
    }
    expr += this.currentNum;
    this.inputValue = expr;
    this.updatePreview();
  }

  private updatePreview(): void {
    if (this.isErr) {
      return;
    }
    if (this.pendingOp !== '' || this.tokens.length === 0) {
      this.calValue = '';
      return;
    }
    const draft: Array<string> = Array.from(this.tokens);
    if (this.currentNum.length > 0 && this.currentNum !== '-') {
      draft.push(this.currentNum);
    }
    const preview: string = CalculateUtil.parseExpression(draft, this.angleMode);
    this.calValue = preview === 'NaN' ? '' : preview;
  }

  private resetAll(): void {
    this.tokens = [];
    this.currentNum = '';
    this.pendingOp = '';
    this.pendingOperand = '';
    this.isErr = false;
    this.lastBtnIsEqu = false;
    this.justApplied = false;
    this.calValue = '';
    this.inputValue = '';
  }

  private setErr(): void {
    this.isErr = true;
    this.inputValue = this.resourceToString($r('app.string.error'));
    this.calValue = '';
  }

  private commitCurrent(): void {
    if (this.currentNum.length > 0 && this.currentNum !== '-') {
      this.tokens.push(this.currentNum);
    }
    this.currentNum = '';
    this.justApplied = false;
  }

  /**
   * Resolve a pending x^y / y-root step into currentNum, if any.
   */
  private resolvePending(): boolean {
    if (this.pendingOp === '') {
      return true;
    }
    if (this.currentNum.length === 0 || this.currentNum === '-') {
      return false;
    }
    let r: string;
    if (this.pendingOp === 'pow') {
      r = CalculateUtil.applyPow(this.pendingOperand, this.currentNum);
    } else {
      // root (ʸ√x): pendingOperand is the radicand, currentNum is the index/degree.
      // Result = radicand ^ (1 / degree).
      const idx: number = Number(this.currentNum);
      if (Number.isNaN(idx) || idx === 0) {
        this.setErr();
        return false;
      }
      r = CalculateUtil.applyPow(this.pendingOperand, (1 / idx).toString());
    }
    this.pendingOp = '';
    this.pendingOperand = '';
    if (r === 'NaN') {
      this.setErr();
      return false;
    }
    this.currentNum = r;
    return true;
  }

  /**
   * Display name used when rendering a function token (e.g. "sin", "√").
   */
  private funcDisplayName(op: string): string {
    switch (op) {
      case 'sin': return 'sin';
      case 'cos': return 'cos';
      case 'tan': return 'tan';
      case 'asin': return 'sin⁻¹';
      case 'acos': return 'cos⁻¹';
      case 'atan': return 'tan⁻¹';
      case 'ln': return 'ln';
      case 'log': return 'lg';
      case 'exp': return 'eˣ';
      case 'pow10': return '10ˣ';
      case 'sqrt': return '√';
      case 'cbrt': return '∛';
      case 'square': return 'sqr';
      case 'cube': return 'cube';
      case 'inv': return '1/';
      case 'fact': return 'fact';
      case 'abs': return 'abs';
      default: return op;
    }
  }

  // ---------- key handlers ----------

  private onKeyTap(key: ScientificKeyItem): void {
    if (this.isErr && key.type !== 'clear') {
      return;
    }
    switch (key.type) {
      case 'digit': this.appendDigit(key.label); break;
      case 'dot': this.appendDot(); break;
      case 'pct': this.applyPercent(); break;
      case 'neg': this.negateCurrent(); break;
      case 'op': this.appendOperator(key.op ?? key.label); break;
      case 'eq': this.evaluate(); break;
      case 'clear': this.resetAll(); break;
      case 'del': this.backspace(); break;
      case 'func': this.applyFunc(key.op ?? ''); break;
      case 'const': this.insertConstant(key.op ?? ''); break;
      case 'mem': this.memoryOp(key.op ?? ''); break;
      case 'inv': this.invMode = !this.invMode; break;
      case 'angle': this.angleMode = this.angleMode === ANGLE_RAD ? ANGLE_DEG : ANGLE_RAD; break;
      case 'pow': this.startPending('pow'); break;
      case 'root': this.startPending('root'); break;
      case 'lparen': this.pushLeftParen(); break;
      case 'rparen': this.pushRightParen(); break;
      default: break;
    }
  }

  private appendDigit(d: string): void {
    if (this.lastBtnIsEqu) {
      this.resetAll();
    } else if (this.justApplied) {
      this.currentNum = '';
    }
    this.lastBtnIsEqu = false;
    this.justApplied = false;
    if (this.currentNum === '0') {
      this.currentNum = d;
    } else {
      this.currentNum = this.currentNum + d;
    }
    this.refresh();
  }

  private appendDot(): void {
    if (this.lastBtnIsEqu) {
      this.resetAll();
    } else if (this.justApplied) {
      this.currentNum = '';
    }
    this.lastBtnIsEqu = false;
    this.justApplied = false;
    if (this.currentNum.indexOf('.') === -1) {
      this.currentNum = (this.currentNum.length === 0 || this.currentNum === '-') ?
        this.currentNum + '0.' : this.currentNum + '.';
    }
    this.refresh();
  }

  private appendOperator(sym: string): void {
    this.lastBtnIsEqu = false;
    if (!this.resolvePending()) {
      return;
    }
    const lastIdx: number = this.tokens.length - 1;
    const lastTok: string = lastIdx >= 0 ? this.tokens[lastIdx] : '';
    const prevIsOpenOrOp: boolean = lastIdx < 0 || lastTok === '(' ||
      CalculateUtil.isSymbol(lastTok);
    // Unary minus: start of expression, after '(' or after an operator.
    if (sym === '-' && this.currentNum.length === 0 && prevIsOpenOrOp) {
      this.currentNum = '-';
      this.refresh();
      return;
    }
    if (this.currentNum.length > 0 && this.currentNum !== '-') {
      this.commitCurrent();
    } else if (this.currentNum === '-') {
      // A stray unary '-' followed by a binary operator: discard it.
      this.currentNum = '';
    }
    if (lastIdx >= 0 && CalculateUtil.isSymbol(this.tokens[lastIdx])) {
      this.tokens[lastIdx] = sym;
    } else {
      this.tokens.push(sym);
    }
    this.refresh();
  }

  private pushLeftParen(): void {
    if (this.lastBtnIsEqu) {
      this.resetAll();
    }
    this.lastBtnIsEqu = false;
    if (!this.resolvePending()) {
      return;
    }
    const lastIdx: number = this.tokens.length - 1;
    const lastTok: string = lastIdx >= 0 ? this.tokens[lastIdx] : '';
    // Implicit multiplication: "3(" -> "3×(" and ")( " -> ")×(".
    if (this.currentNum.length > 0 && this.currentNum !== '-') {
      this.commitCurrent();
      this.tokens.push('×');
    } else if (lastIdx >= 0 && lastTok === ')') {
      this.tokens.push('×');
    }
    this.tokens.push('(');
    this.refresh();
  }

  private pushRightParen(): void {
    this.lastBtnIsEqu = false;
    if (!this.resolvePending()) {
      return;
    }
    this.commitCurrent();
    let open: number = 0;
    let close: number = 0;
    this.tokens.forEach((t: string) => {
      if (t === '(') {
        open++;
      } else if (t === ')') {
        close++;
      }
    });
    if (open > close) {
      this.tokens.push(')');
      this.refresh();
      // Closing a parenthesis must not behave like "=": only "=" evaluates.
      // Clear the live-preview so the result is not shown until the user taps "=".
      this.calValue = '';
    } else {
      this.refresh();
    }
  }

  private negateCurrent(): void {
    this.lastBtnIsEqu = false;
    if (this.currentNum.length === 0) {
      return;
    }
    if (this.currentNum.startsWith('-')) {
      this.currentNum = this.currentNum.substring(1);
    } else {
      this.currentNum = '-' + this.currentNum;
    }
    this.refresh();
  }

  private applyPercent(): void {
    this.lastBtnIsEqu = false;
    this.justApplied = false;
    const n: number = Number(this.currentNum);
    if (this.currentNum.length === 0 || Number.isNaN(n)) {
      return;
    }
    this.currentNum = CalculateUtil.numberToScientificNotation(n / 100);
    this.justApplied = true;
    this.refresh();
  }

  private backspace(): void {
    if (this.lastBtnIsEqu) {
      this.resetAll();
      return;
    }
    this.justApplied = false;
    if (this.currentNum.length > 0) {
      this.currentNum = this.currentNum.substring(0, this.currentNum.length - 1);
      if (this.currentNum === '-') {
        this.currentNum = '';
      }
    } else if (this.pendingOp !== '') {
      this.pendingOp = '';
      this.pendingOperand = '';
    } else if (this.tokens.length > 0) {
      this.tokens.pop();
    }
    this.refresh();
  }

  private applyFunc(op: string): void {
    if (this.lastBtnIsEqu) {
      this.resetAll();
    }
    this.lastBtnIsEqu = false;
    if (!this.resolvePending()) {
      return;
    }
    let realOp: string = op;
    if (this.invMode) {
      if (op === 'sin') {
        realOp = 'asin';
      } else if (op === 'cos') {
        realOp = 'acos';
      } else if (op === 'tan') {
        realOp = 'atan';
      } else if (op === 'ln') {
        realOp = 'exp';
      } else if (op === 'log') {
        realOp = 'pow10';
      }
    }
    if (this.currentNum.length > 0 && this.currentNum !== '-') {
      // Apply immediately to the current number.
      const result: string = CalculateUtil.applyFunction(this.currentNum, realOp, this.angleMode);
      if (result === 'NaN') {
        this.setErr();
        return;
      }
      this.currentNum = result;
      this.justApplied = true;
    } else {
      // No argument yet: push a function token + '(' so the user can type a
      // full sub-expression as the argument (e.g. sin(π/2), sqrt(-4)).
      const lastIdx: number = this.tokens.length - 1;
      const lastTok: string = lastIdx >= 0 ? this.tokens[lastIdx] : '';
      if (lastIdx >= 0 && lastTok === ')') {
        // Implicit multiplication: ")( " adjacency -> ")×func(".
        this.tokens.push('×');
      }
      this.tokens.push(realOp);
      this.tokens.push('(');
      this.currentNum = '';
      this.justApplied = false;
    }
    this.refresh();
  }

  private insertConstant(op: string): void {
    if (this.lastBtnIsEqu) {
      this.resetAll();
    }
    this.lastBtnIsEqu = false;
    if (!this.resolvePending()) {
      return;
    }
    const constStr: string = op === 'pi' ? PI_STR : E_STR;
    const lastIdx: number = this.tokens.length - 1;
    const lastTok: string = lastIdx >= 0 ? this.tokens[lastIdx] : '';
    if (this.currentNum.length > 0 && this.currentNum !== '-') {
      // Implicit multiplication: "2" + "π" becomes "2×π".
      this.commitCurrent();
      this.tokens.push('×');
      this.currentNum = constStr;
    } else if (lastIdx >= 0 && lastTok === ')') {
      // Implicit multiplication: ")( " adjacency -> ")×π".
      this.tokens.push('×');
      this.currentNum = constStr;
    } else {
      this.currentNum = constStr;
    }
    this.justApplied = true;
    this.refresh();
  }

  private memoryOp(op: string): void {
    this.lastBtnIsEqu = false;
    if (!this.resolvePending()) {
      return;
    }
    const cur: number = this.currentNum.length > 0 ? Number(this.currentNum) : 0;
    const mem: number = this.memoryValue.length > 0 ? Number(this.memoryValue) : 0;
    if (op === 'mc') {
      this.memoryValue = '';
    } else if (op === 'mplus') {
      this.memoryValue = CalculateUtil.formatNumber(mem + cur, 10);
    } else if (op === 'mminus') {
      this.memoryValue = CalculateUtil.formatNumber(mem - cur, 10);
    } else if (op === 'mr') {
      if (this.memoryValue.length > 0) {
        this.currentNum = this.memoryValue;
        this.refresh();
      }
    }
  }

  private startPending(kind: string): void {
    this.lastBtnIsEqu = false;
    if (!this.resolvePending()) {
      return;
    }
    if (this.currentNum.length === 0 || this.currentNum === '-') {
      return;
    }
    this.pendingOperand = this.currentNum;
    this.pendingOp = kind;
    this.currentNum = '';
    this.refresh();
  }

  private evaluate(): void {
    if (this.isErr) {
      return;
    }
    if (!this.resolvePending()) {
      return;
    }
    this.commitCurrent();
    if (this.tokens.length === 0) {
      return;
    }
    const r: string = CalculateUtil.parseExpression(Array.from(this.tokens), this.angleMode);
    if (r === 'NaN') {
      this.setErr();
      return;
    }
    this.tokens = [];
    this.currentNum = r;
    this.lastBtnIsEqu = true;
    this.calValue = '';
    this.inputValue = r;
  }

  private resourceToString(resource: Resource): string {
    let result: string = '';
    try {
      result = (this.uiContext.getHostContext() as common.UIAbilityContext).resourceManager.getStringSync(resource.id);
    } catch (error) {
      Logger.error('[Scientific] getResourceString fail: ' + JSON.stringify(error));
    }
    return result;
  }
}
