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
 * Basic calculator key item.
 *  flag:
 *    0 = delete (icon image)
 *    1 = digit / dot / percent
 *    2 = operator or C (gray background)
 *    3 = equals (orange background)
 *    4 = negate ±
 */
export class PressKeyItem {
  flag: number;
  value: string;
  source?: Resource;

  constructor(flag: number, value: string, source?: Resource) {
    this.flag = flag;
    this.value = value;
    this.source = source;
  }
}
