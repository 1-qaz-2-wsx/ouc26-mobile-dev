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

import { KinshipUtil, Gender } from '../common/util/KinshipUtil';
import keysModel, { KeyFlag } from '../viewmodel/RelationshipKeyViewModel';
import { RelationshipKeyItem } from '../viewmodel/RelationshipKeyItem';
import { CommonConstants } from '../common/constants/CommonConstants';
import { buildNavMenu } from '../common/util/NavMenu';

/**
 * Three query modes supported by the relationship page.
 *  0 = 查询亲戚的称呼 (find the title to call this relative)
 *  1 = 查询亲戚对我的称呼 (find what this relative calls me)
 *  2 = 根据称呼查询关系 (find the relationship from a title)
 */
const MODE_FIND_TITLE: number = 0;
const MODE_FIND_REVERSE: number = 1;
const MODE_FIND_RELATION: number = 2;

@Entry
@Component
struct RelationshipPage {
  @State queryMode: number = MODE_FIND_TITLE;
  @State @Watch('onInputsChange') chain: string[] = [];
  @State myGender: Gender = 'F';
  @State resultTitle: string = '';
  @State resultDesc: string = '';

  uiContext = this.getUIContext();
  @StorageLink('topRectHeight') topRectHeight: number = 0;
  @StorageLink('bottomRectHeight') bottomRectHeight: number = 0;

  aboutToAppear(): void {
    const savedMode = AppStorage.get('queryMode') as number;
    this.queryMode = savedMode ?? MODE_FIND_TITLE;
    const savedGender = AppStorage.get('relationshipGender') as Gender;
    this.myGender = savedGender ?? 'F';
    this.onInputsChange();
  }

  onInputsChange(): void {
    if (this.chain.length === 0) {
      this.resultTitle = '';
      this.resultDesc = '';
      return;
    }
    if (this.queryMode === MODE_FIND_RELATION) {
      // Mode 3: title -> relationship description.
      this.resultTitle = this.chain[0];
      this.resultDesc = KinshipUtil.getRelationByTitle(this.chain[0]);
    } else if (this.queryMode === MODE_FIND_REVERSE) {
      // Mode 2: what this relative calls me.
      this.resultTitle = KinshipUtil.getReverseTitleByChain(this.chain, this.myGender);
      this.resultDesc = KinshipUtil.getChainDescription(this.chain);
    } else {
      // Mode 1 (default): the title to call this relative.
      this.resultTitle = KinshipUtil.getTitleByChain(this.chain, this.myGender);
      this.resultDesc = KinshipUtil.getChainDescription(this.chain);
    }
  }

  onKeyTap(key: RelationshipKeyItem): void {
    if (key.flag === KeyFlag.DEL) {
      if (this.chain.length > 0) {
        this.chain = this.chain.slice(0, this.chain.length - 1);
      }
      return;
    }
    if (key.flag === KeyFlag.CLR) {
      this.chain = [];
      return;
    }
    if (this.queryMode === MODE_FIND_RELATION) {
      // Mode 3: each title tap replaces the current selection.
      this.chain = [key.value];
    } else {
      // Modes 1 & 2: try to append; silently ignore invalid steps
      // (e.g. trying to add a husband to a male node), so the chain
      // stays valid and "—" never gets displayed.
      const newChain = KinshipUtil.tryAppendToken(this.chain, key.value, this.myGender);
      if (newChain !== null) {
        this.chain = newChain;
      }
    }
  }

  switchMode(): void {
    const next: number = (this.queryMode + 1) % 3;
    this.queryMode = next;
    AppStorage.setOrCreate('queryMode', next);
    this.onInputsChange();
  }

  getCurrentModeLabel(): Resource {
    if (this.queryMode === MODE_FIND_REVERSE) {
      return $r('app.string.relationship_mode_find_reverse');
    }
    if (this.queryMode === MODE_FIND_RELATION) {
      return $r('app.string.relationship_mode_find_relation');
    }
    return $r('app.string.relationship_mode_find_title');
  }

  build() {
    Column() {
      // ===== 1. Top bar: page title + feature menu (all functions, current marked ✓). =====
      Row() {
        Text($r('app.string.relationship_title'))
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
          .bindMenu(buildNavMenu('relationship'));
      }
      .width('100%')
      .padding({ left: 16, right: 12, top: 6, bottom: 4 })
      .margin({ top: this.uiContext.px2vp(this.topRectHeight) })
      .alignItems(VerticalAlign.Center);

      // ===== 2. Gender selector - female first, default female. =====
      Row() {
        Text($r('app.string.relationship_gender_label'))
          .fontSize(14)
          .fontColor('rgba(0, 0, 0, 0.85)')
          .layoutWeight(1);

        Row() {
          Radio({ value: 'female', group: 'gender' })
            .checked(this.myGender === 'F')
            .onChange((isChecked: boolean) => {
              if (isChecked) {
                this.myGender = 'F';
                AppStorage.setOrCreate('relationshipGender', 'F');
                this.onInputsChange();
              }
            })
            .height(20)
            .width(20);
          Text($r('app.string.relationship_gender_female'))
            .fontSize(14)
            .fontColor(Color.Black)
            .margin({ left: 4 });
        }
        .alignItems(VerticalAlign.Center)
        .margin({ right: 20 });

        Row() {
          Radio({ value: 'male', group: 'gender' })
            .checked(this.myGender === 'M')
            .onChange((isChecked: boolean) => {
              if (isChecked) {
                this.myGender = 'M';
                AppStorage.setOrCreate('relationshipGender', 'M');
                this.onInputsChange();
              }
            })
            .height(20)
            .width(20);
          Text($r('app.string.relationship_gender_male'))
            .fontSize(14)
            .fontColor(Color.Black)
            .margin({ left: 4 });
        }
        .alignItems(VerticalAlign.Center);
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 8, bottom: 8 })
      .alignItems(VerticalAlign.Center);

      Divider()
        .color('rgba(0, 0, 0, 0.06)')
        .strokeWidth(1)
        .margin({ left: 12, right: 12 });

      // ===== 3. Result area - fills all space between gender row and keyboard. =====
      Column() {
        if (this.resultTitle.length === 0) {
          // Empty placeholder - matches reference design.
        } else if (this.queryMode === MODE_FIND_RELATION) {
          Text($r('app.string.relationship_label_relation'))
            .fontSize(12)
            .fontColor('rgba(0, 0, 0, 0.55)')
            .width('100%')
            .textAlign(TextAlign.Center);
          Text(this.resultTitle)
            .fontSize(26)
            .fontWeight(FontWeight.Bold)
            .fontColor(Color.Black)
            .margin({ top: 6 });
          Text(this.resultDesc)
            .fontSize(14)
            .fontColor('rgba(0, 0, 0, 0.65)')
            .margin({ top: 8 })
            .width('100%')
            .textAlign(TextAlign.Center);
        } else if (this.queryMode === MODE_FIND_REVERSE) {
          Text($r('app.string.relationship_label_reverse'))
            .fontSize(12)
            .fontColor('rgba(0, 0, 0, 0.55)')
            .width('100%')
            .textAlign(TextAlign.Center);
          Text(this.resultTitle)
            .fontSize(26)
            .fontWeight(FontWeight.Bold)
            .fontColor(Color.Black)
            .margin({ top: 6 });
          if (this.resultDesc.length > 0) {
            Text(this.resultDesc)
              .fontSize(14)
              .fontColor('rgba(0, 0, 0, 0.65)')
              .margin({ top: 8 })
              .width('100%')
              .textAlign(TextAlign.Center);
          }
        } else {
          Text($r('app.string.relationship_label_title'))
            .fontSize(12)
            .fontColor('rgba(0, 0, 0, 0.55)')
            .width('100%')
            .textAlign(TextAlign.Center);
          Text(this.resultTitle)
            .fontSize(30)
            .fontWeight(FontWeight.Bold)
            .fontColor(Color.Black)
            .margin({ top: 6 });
          if (this.resultDesc.length > 0) {
            Text(this.resultDesc)
              .fontSize(14)
              .fontColor('rgba(0, 0, 0, 0.65)')
              .margin({ top: 8 })
              .width('100%')
              .textAlign(TextAlign.Center);
          }
        }
      }
      .width('100%')
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .padding({ left: 24, right: 24, top: 8, bottom: 8 });

      // ===== 4. Keyboard panel (grey rounded top, same as calculator pages). =====
      Column() {
        // Mode-switcher: chip button + current mode label.
        Row() {
          Text($r('app.string.relationship_switch_label'))
            .fontSize(14)
            .fontColor('#007AFF')
            .fontFamily(CommonConstants.FONT_FAMILY_1)
            .fontWeight(FontWeight.Medium)
            .backgroundColor(Color.White)
            .borderRadius(40)
            .padding({ left: 22, right: 22, top: 10, bottom: 10 })
            .onClick(() => {
              this.switchMode();
            });
          Blank();
          Text(this.getCurrentModeLabel())
            .fontSize(12)
            .fontColor('rgba(0, 0, 0, 0.6)')
            .margin({ right: 4 });
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 10, bottom: 10 })
        .alignItems(VerticalAlign.Center);

        Grid() {
          ForEach(
            this.queryMode === MODE_FIND_RELATION ? keysModel.getTitleKeys() : keysModel.getRelationKeys(),
            (row: Array<RelationshipKeyItem>) => {
              ForEach(row, (item: RelationshipKeyItem) => {
                GridItem() {
                  Text(item.value)
                    .fontSize(item.flag === KeyFlag.DEL || item.flag === KeyFlag.CLR ? 16 : 18)
                    .fontColor(Color.Black)
                    .fontFamily(CommonConstants.FONT_FAMILY_1)
                    .fontWeight(FontWeight.Medium)
                    .width('100%')
                    .height('100%')
                    .textAlign(TextAlign.Center);
                }
                .backgroundColor(item.flag === KeyFlag.DEL || item.flag === KeyFlag.CLR ? '#E5E5EA' : 'rgb(255, 255, 255)')
                .borderRadius(40)
                .onClick(() => {
                  this.onKeyTap(item);
                });
              }, (item: RelationshipKeyItem) => `${this.queryMode}_${item.value}_${item.flag}`);
            },
            (row: Array<RelationshipKeyItem>, rowIndex: number) => `${this.queryMode}_row_${rowIndex}`
          );
        }
        .columnsTemplate('1fr 1fr 1fr 1fr')
        .rowsTemplate('1fr 1fr 1fr')
        .columnsGap(8)
        .rowsGap(10)
        .width('100%')
        .height(168)
        .padding({ left: 12, right: 12, top: 8, bottom: 8 });
      }
      .width('100%')
      .padding({ bottom: this.uiContext.px2vp(this.bottomRectHeight) + 4 })
      .backgroundColor(Color.Transparent);
    }
    .width('100%')
    .height(CommonConstants.FULL_PERCENT)
    .backgroundColor($r('app.color.all_back_color'));
  }
}
