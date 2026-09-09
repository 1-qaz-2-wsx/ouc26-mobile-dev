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

import router from '@ohos.router';
import Logger from './Logger';

/**
 * A single navigation entry shown in the top-right feature menu.
 */
interface NavEntry {
  key: string;
  label: string;
  url: string;
}

/**
 * All six features. Order matters: it is the order shown in the menu.
 */
const ENTRIES: NavEntry[] = [
  { key: 'calculator', label: '普通计算器', url: 'pages/MainPage' },
  { key: 'scientific', label: '科学计算器', url: 'pages/ScientificPage' },
  { key: 'relationship', label: '亲戚称呼换算', url: 'pages/RelationshipPage' },
  { key: 'base', label: '进制转换', url: 'pages/BaseConverterPage' },
  { key: 'unit', label: '单位换算', url: 'pages/UnitConverterPage' },
  { key: 'currency', label: '汇率换算', url: 'pages/CurrencyConverterPage' }
];

/**
 * Build the menu items for the top-right feature menu.
 *
 * @param current The key of the page that is currently displayed. Its menu
 *                entry gets a trailing " ✓" mark; tapping it does nothing.
 * @return The menu items accepted by `bindMenu`.
 */
export function buildNavMenu(current: string): Array<MenuElement> {
  const result: Array<MenuElement> = [];
  ENTRIES.forEach((entry: NavEntry) => {
    const label: string = entry.key === current ? `${entry.label}  ✓` : entry.label;
    const item: MenuElement = {
      value: label,
      action: (): void => {
        if (entry.key !== current) {
          router.replaceUrl({ url: entry.url }).catch((err: Error) => {
            Logger.error('[NavMenu] replaceUrl ' + entry.url + ' fail: ' + JSON.stringify(err));
          });
        }
      }
    };
    result.push(item);
  });
  return result;
}
