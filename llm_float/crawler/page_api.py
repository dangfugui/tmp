# -*- coding: utf-8 -*-
"""拍机堂页面操作封装 — 连9222、监听API、选品/品牌/型号、遍历商品价格"""

import json, os, time, logging, random
from DrissionPage import ChromiumOptions, WebPage


try:
    from line_profiler import profile
except ImportError:
    def profile(f): return f  # 无line_profiler时装饰器不生效

logger = logging.getLogger("paijitang")

class PageApi:
    def __init__(self, port=9222,
                 user_data=os.path.join(os.environ["LOCALAPPDATA"], r"Google\Chrome\User Data_9222")):
        co = ChromiumOptions().set_local_port(port).set_user_data_path(user_data)
        self.page = WebPage(chromium_options=co)
        self._detail_tab = self.page.new_tab()   # 暗拍详情页（系列映射 + 价格遍历，复用不关）
        self._detail_url = None   # 当前已加载的详情页URL（用于判断是否需重新定位DOM）
        self._detail_inp = None   # 缓存：搜索框input元素引用（同URL复用，省DOM查询）
        self._detail_btn = None   # 缓存：查询按钮元素引用（同URL复用，省DOM查询）

    # ─── 资源释放 ──────────────────────────────

    def close(self):
        """关闭 _detail_tab 和 page，释放浏览器标签页"""
        try:
            self._detail_tab.close()
        except Exception:
            pass


    # ─── 阿里云滑块处理 ──────────────────────────

    @staticmethod
    def _find_slider(tab):
        """返回 (滑块元素, 容器元素) 或 (None, None)"""
        for sel in [".slider-move.initial", "#aliyunCaptcha-sliding-slider",
                     ".aliyunCaptcha-sliding-slider"]:
            e = tab.ele("css:" + sel, timeout=0.5)
            if e:
                return e, tab.ele("css:.aliyun-captcha", timeout=0.5)
        return None, None

    def handle_captcha(self, tab=None, max_retries=10) -> bool:
        """
        检测并拖动阿里云滑块。用 CDP Input.dispatchMouseEvent 模拟原生鼠标事件。
        策略：每3次先假拖10-20%试探；真拖用6种缓动+过冲回退+Y抖动，保证前进递增。
        每次重试重新定位滑块坐标；滑完后刷新页面判断滑块是否还在。
        返回 True 表示无滑块或验证通过。
        """
        if tab is None:
            tab = self._detail_tab
        if not self._find_slider(tab)[0]:
            return True

        for attempt in range(max_retries):
            # ── 每次重新定位滑块（防止坐标过期 / 刷新后位移） ──
            slider, container = self._find_slider(tab)
            if not slider:
                logger.info("滑块已消失，验证通过 ✓")
                return True
            rect = slider.rect
            cx = rect.location[0] + rect.size[0] // 2
            cy = rect.location[1] + rect.size[1] // 2
            track_w = container.rect.size[0] if container and container.rect else 300
            base_dist = int(track_w - rect.size[0]) if track_w - rect.size[0] > 50 else 250

            # ── 第3/6/9...次先假拖 10-20% 再松手，模拟人类试探 ──
            if (attempt + 1) % 3 == 0:
                fake_dist = int(base_dist * random.uniform(0.10, 0.20))
                logger.info(f"滑块 (第{attempt+1}次, 假拖~{fake_dist}px)")
                tab.run_cdp('Input.dispatchMouseEvent', type='mousePressed', x=cx, y=cy, button='left', clickCount=1)
                time.sleep(random.uniform(0.15, 0.35))
                for i in range(1, random.randint(6, 10)):
                    t = i / 8
                    eased = 1 - (1 - t) * (1 - t)
                    pos = min(int(fake_dist * eased), fake_dist)
                    tab.run_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=cx + max(pos, 1), y=cy + random.randint(-2, 2))
                    time.sleep(random.uniform(0.015, 0.040))
                time.sleep(random.uniform(0.05, 0.12))
                tab.run_cdp('Input.dispatchMouseEvent', type='mouseReleased', x=cx + fake_dist, y=cy, button='left')
                time.sleep(random.uniform(0.3, 0.6))

            # ── 真拖：JS 生成轨迹（6种缓动+过冲回退+Y抖动） ──
            real_dist = base_dist + random.randint(-15, 15)
            traj = tab.run_js(f"""
            const steps={25 + random.randint(0, 12)}, dist={real_dist};
            const easeType=Math.floor(Math.random()*6);
            const overshoot=Math.random()<0.4?5+Math.floor(Math.random()*15):0;
            const pts=[];
            for(let i=1;i<=steps;i++){{
                const t=i/steps;
                let e;
                switch(easeType){{
                    case 0:e=3*t*t-2*t*t*t;break;
                    case 1:e=1-(1-t)**2;break;
                    case 2:e=t<0.5?4*t*t*t:1-(-2*t+2)**3/2;break;
                    case 3:e=1-(1-t)**3;break;
                    case 4:e=t<0.5?2*t*t:1-(-2*t+2)**2/2;break;
                    default:e=t*t;
                }}
                let x;
                if(overshoot>0&&t>0.85){{
                    const rt=(t-0.85)/0.15;
                    x=(dist+overshoot)*(1-rt)+dist*rt;
                }}else{{
                    x=(dist+overshoot)*e;
                }}
                const yj=Math.random()<0.1?(Math.random()-0.5)*12:(Math.random()-0.5)*5;
                pts.push([Math.max(1,x|0),yj|0]);
            }}
            return pts;
            """)
            if not traj:
                traj = [[int(real_dist * i / 25), 0] for i in range(1, 26)]

            pause_idx = random.randint(0, len(traj) - 1) if traj else -1
            logger.info(f"滑块 (第{attempt+1}次, {len(traj)}步, 目标~{real_dist}px)")
            tab.run_cdp('Input.dispatchMouseEvent', type='mousePressed', x=cx, y=cy, button='left', clickCount=1)
            time.sleep(random.uniform(0.15, 0.35))
            moved = 0
            for idx, (px, py) in enumerate(traj):
                if px <= moved:
                    px = moved + 1
                moved = px
                tab.run_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=cx + px, y=cy + int(py))
                if idx == pause_idx:
                    time.sleep(random.uniform(0.06, 0.16))
                else:
                    time.sleep(random.uniform(0.010, 0.035))
            time.sleep(random.uniform(0.08, 0.18))
            tab.run_cdp('Input.dispatchMouseEvent', type='mouseReleased', x=cx + moved, y=cy, button='left')

            # ── 先等验证处理，滑块消失则通过；仍在则刷新后判断 ──
            time.sleep(2.5)  # 等服务端验证完成
            if not self._find_slider(tab)[0]:
                logger.info(f"滑块验证通过 ✓ (第{attempt+1}次)")
                return True
            # 滑块仍在 → 刷新页面拿干净状态，避免元素过期崩溃
            tab.run_js("location.reload()")
            tab.wait.doc_loaded()
            # SPA 渲染慢，轮询5s等滑块出现（防止页面没加载完就误判通过）
            slider_after = None
            for _ in range(10):
                time.sleep(0.5)
                slider_after, _ = self._find_slider(tab)
                if slider_after:
                    break
            if not slider_after:
                logger.info(f"刷新后滑块已消失，验证通过 ✓ (第{attempt+1}次)")
                return True
            logger.warning(f"刷新后滑块仍在 (第{attempt+1}次/{max_retries})，重试...")
            time.sleep(1)

        logger.error(f"滑块 {max_retries} 次尝试均失败，请手动完成验证")
        return False

    # ─── 登录检测 + 自动登录 ────────────────────

    def ensure_login(self, tab=None, max_wait=8, max_login_retries=3) -> bool:
        """
        检测当前页面是否有登录表单，有则自动：勾选条款 → 点登录 → 过滑块 → 等跳转。
        用户名/密码由浏览器记住，无需填写。
        如果滑块验证后刷新导致登录态丢失（表单仍在），自动重新点登录重试。
        返回 True 表示已登录或登录成功。
        """
        if tab is None:
            tab = self._detail_tab

        # ── 检测登录表单 ──
        has_login = tab.run_js("""
            return !!document.querySelector('.pjt-password-login button.submit');
        """)
        if not has_login:
            logger.info("已登录，无需重新登录")
            return True

        logger.info("检测到登录表单，开始自动登录...")

        for login_attempt in range(max_login_retries):
            # 1. 勾选条款 checkbox（antd 需点 wrapper，且需判断是否已勾选）
            tab.run_js("""
                var w = document.querySelector('.pjt-password-login .ant-checkbox-wrapper');
                if (w && !w.classList.contains('ant-checkbox-wrapper-checked')) {
                    w.click();
                }
            """)
            time.sleep(0.5)

            # 2. 点击登录按钮
            tab.run_js("""
                var b = document.querySelector('.pjt-password-login button.submit');
                if (b) b.click();
            """)
            logger.info(f"已点击登录按钮 (第{login_attempt+1}次)，等待滑块...")
            time.sleep(2)

            # 3. 处理滑块（登录后弹出阿里云滑块）
            slider, _ = self._find_slider(tab)
            if not slider:
                time.sleep(2)  # 滑块可能延迟出现，再等一下
                slider, _ = self._find_slider(tab)

            if slider:
                logger.info("检测到滑块，开始处理...")
                ok = self.handle_captcha(tab)
                if not ok:
                    logger.error("滑块验证失败，请手动完成")
                    return False
            else:
                logger.warning("未检测到滑块，可能已直接登录或滑块形式变化")

            # 4. 等待登录完成（登录表单消失 = 登录成功）
            for _ in range(max_wait):
                time.sleep(1)
                still_login = tab.run_js("""
                    return !!document.querySelector('.pjt-password-login button.submit');
                """)
                if not still_login:
                    logger.info("登录成功 ✓")
                    time.sleep(1)  # 等页面跳转稳定
                    return True

            # 登录表单仍在 → 可能是滑块验证后刷新丢了登录态，重新点登录重试
            if login_attempt < max_login_retries - 1:
                logger.warning(f"登录表单仍在，重新尝试 (第{login_attempt+2}次)...")
            else:
                logger.error(f"登录 {max_login_retries} 次尝试均失败")
        return False

    # ─── popover 级联点击 ───
    @profile
    @staticmethod
    def _popup_series(tab, texts):
        """级联选择：依次点 texts 中的按钮，最后点确 认"""
        def _click(text):
            safe = text.replace("'", "\\'")
            js = f"var b=Array.from(document.querySelectorAll('.pjt-next-antd-popover-inner-content button')).find(b=>b.textContent.trim()==='{safe}');if(b){{b.click();return true;}}return false;"
            for _ in range(50):  # 轮询，20ms×50=最多等1s
                if tab.run_js(js): break
                time.sleep(0.02)
        for t in texts:
            _click(t)
        _click('确 认')

    # ─── 获取品牌列表 / 型号映射 ───
    @profile
    def get_series_mapping(self, tree = [], detail_url=None):
        """
        获取品类/品牌/型号的级联列表。

        通过 antd Cascader 逐级展开选择，监听 API 响应获取数据。

        :param tree: 层级路径，逐级深入
            []               → 品类列表 ["手机", "电脑", ...]
            ["手机"]         → 品牌列表 ["苹果", "华为", ...]
            ["手机", "苹果"] → 型号映射 {"iPhone 17e": 265024, ...}
        :param detail_url: 详情页 URL
        :return: list 或 dict，取决于 tree 深度
        """
        tab = self._detail_tab
        for retry in range(2):  # 第2次为重试（滑块处理后的恢复）
            tab.listen.start(['categories/list', '/brands/list', '/products/series-list'][len(tree)])
            if tab.url != detail_url:
                tab.get(detail_url)
                tab.wait.doc_loaded()
                # 展开级联选择器（antd Cascader 需 mousedown+mouseup+click 三事件）
            tab.run_js("var e=document.querySelector('input[placeholder=\"请选择\"]');if(e){e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));e.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));e.click();}")
            if tree: self._popup_series(tab, tree)
            # 收集 API 响应（最多等3次，过滤掉 levels 接口的包）
            time.sleep(0.1)
            for _ in range(10):
                p = tab.listen.wait(timeout=5)
                if not p: 
                    self._popup_series(tab, tree);time.sleep(0.2);continue
                if p.response : return p.response.body['data']
            # 不 stop，下次 listen.start 自动切换 target 并清空旧包
            if retry > 0:
                break
            # 全部超时 → 可能滑块拦截，处理一次重试
            logger.warning("get_series_mapping 超时，检测滑块...")
            if not self._find_slider(tab)[0]:
                logger.warning("未检测到滑块，可能是网络问题或页面异常");
                return []  #    非滑块问题，直接放弃
            self.handle_captcha(tab)
        logger.warning(f"get_series_mapping({tree}) 超时，未获取到数据")
        return []
    # ─── 遍历型号→获取商品价格→排序 ───

    def _wait_js_ready(self, tab, timeout=8):
        """等待页面 JS 上下文就绪（解决 SPA 刷新后 doc_loaded 但上下文未恢复的问题）"""
        for _ in range(timeout * 10):
            try:
                r = tab.run_js("return document.readyState")
                if r == 'complete':
                    return True
            except Exception:
                pass
            time.sleep(0.1)
        return False

    def _recover_tab(self, detail_url):
        """页面上下文丢失后恢复：重新导航 + 等待就绪 + 注入 pageSize + 启动监听"""
        tab = self._detail_tab
        logger.warning(f"页面上下文丢失，重新导航: {detail_url}")
        tab.get(detail_url)
        self._wait_js_ready(tab)
        time.sleep(0.5)
        self._inject_page_size(tab, 100)
        tab.listen.start('goods/dark/running/goods')
        self._detail_url = detail_url

    @staticmethod
    def _inject_page_size(tab, size=100):
        """注入 JS，拦截 goods API 的 POST body，把 pageSize 改成指定值"""
        tab.run_js(f"""
        (function() {{
          var _fetch = window.fetch;
          window.fetch = function(url, opts) {{
            if (typeof url === 'string' && url.includes('goods') && opts && opts.body) {{
              try {{ var b = JSON.parse(opts.body); if (b.pageSize) {{ b.pageSize = {size}; opts.body = JSON.stringify(b); }} }} catch(e) {{}}
            }}
            return _fetch.apply(this, arguments);
          }};
          var _open = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url) {{ this._xhrUrl = url; return _open.apply(this, arguments); }};
          var _send = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function(body) {{
            if (this._xhrUrl && this._xhrUrl.includes('goods') && body) {{
              try {{ var b = JSON.parse(body); if (b.pageSize) {{ b.pageSize = {size}; arguments[0] = JSON.stringify(b); }} }} catch(e) {{}}
            }}
            return _send.apply(this, arguments);
          }};
        }})();
        """)

    @profile
    def get_model_prices(self, detail_url, category_name="手机", brand_name="苹果",
                         models=None, sort_key="startPrice", ascending=True):
        """
        遍历品牌下所有型号，获取商品价格列表。

        通过 antd Cascader 逐级选择 [品类→品牌→型号]，点击查询后监听 goods API 响应。
        页面注入 pageSize=100，一次查询即可拿到全部商品数据。

        :param detail_url:    详情页 URL
        :param category_name: 品类名（如 "手机"）
        :param brand_name:    品牌名（如 "苹果"）
        :param models:        型号筛选
            None → 该品牌所有型号（自动调 get_series_mapping 获取）
            str  → 单个型号
            list → 型号列表
        :param sort_key:      排序字段 ("startPrice" 或 "currentPrice")
        :param ascending:     True 升序，False 降序
        :return: {型号: [{goodsName, startPrice, currentPrice, ...}]}
        """
        if models is None:
            all_models = self.get_series_mapping([category_name, brand_name], detail_url=detail_url)
            if not isinstance(all_models, dict):
                logger.error(f"型号映射未返回字典: {type(all_models)}"); return {}
            model_items = list(all_models.keys())
        elif isinstance(models, str):
            model_items = [models]
        elif isinstance(models, (list, tuple)):
            model_items = models
        else:
            logger.error(f"models 参数类型错误: {type(models)}")
            return {}
        if not model_items:
            logger.error(f"未找到匹配型号 (models={models})")
            return {}
        result = {}
        tab = self._detail_tab
        # ── 首次加载：导航 + 注入 pageSize + 启动监听（同 URL 复用，不重复） ──
        if tab.url != detail_url or  'goods/dark/running/goods' not in tab.listen.targets:
            tab.get(detail_url)
            self._wait_js_ready(tab)
            time.sleep(0.5)
            self._inject_page_size(tab, 100)
            tab.listen.start('goods/dark/running/goods')
            self._detail_url = detail_url
        # 展开级联选择器（带 ContextLostError 自动恢复）
        for _attempt in range(2):
            try:
                tab.run_js("var e=document.querySelector('input[placeholder=\"请选择\"]');if(e){e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));e.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));e.click();}")
                break
            except Exception as e:
                if _attempt == 0 and 'ContextLost' in type(e).__name__:
                    self._recover_tab(detail_url)
                    continue
                raise
        time.sleep(0.1)
        for idx, model_name in enumerate(model_items):
            t0 = time.time()
            try:
                # 级联选择 [品类→品牌→型号]，三事件展开 Cascader
                self._popup_series(tab, [category_name, brand_name, model_name])
                # JS 点击查询按钮
                time.sleep(0.1)
                tab.run_js("var b=[...document.querySelectorAll('button.pjt-next-antd-btn-primary')].find(b=>b.textContent.trim()==='查 询');b&&b.click();")
                # 监听 goods API 响应（pageSize=100 一次拿全）
                time.sleep(0.1)
                records = []
                slider_handled = False
                for _ in range(10):
                    p = tab.listen.wait(timeout=5)
                    if not p:
                        tab.run_js("var b=[...document.querySelectorAll('button.pjt-next-antd-btn-primary')].find(b=>b.textContent.trim()==='查 询');b&&b.click();")
                        time.sleep(0.2)
                        # 超时 → 可能滑块拦截，处理一次
                        if not slider_handled and self._find_slider(tab)[0]:
                            logger.warning(f"{model_name}: listen超时，检测到滑块，自动处理...")
                            self.handle_captcha(tab)
                            slider_handled = True
                        continue
                    if p.response and isinstance(p.response.body, dict) and (min([ model_name in i['mainTitle'] for i in p.response.body['data']]) or _ > 2):
                        d = p.response.body.get('data', [])
                        if isinstance(d, list) and d:
                            records.extend(d); break
                if not records: 
                    logger.warning(f"{model_name}: 无数据"); result[model_name] = []; continue
                if sort_key in ("startPrice", "currentPrice"):
                    records.sort(key=lambda x: x.get(sort_key, 0), reverse=not ascending)
                result[model_name] = records
                logger.info(f"爬取结果{model_name}: {len(records)}条 ({time.time()-t0:.1f}s) ¥{records[0].get(sort_key,0):.0f}~{records[-1].get(sort_key,0):.0f}")
            except Exception as e:
                logger.error(f"{model_name} 异常: {e}"); result[model_name] = []
        # logger.info(f"====== 完成: {len(result)}型号, {n_goods}商品 ======")
        return result

    # ═══════════════════════════════════════════
    #  出价（API + 模拟点击 + 二分法找最高价）
    # ═══════════════════════════════════════════

    def _ensure_row_visible(self, row_key, max_pages=2):
        """确保 row_key 对应的行在当前页面可见，返回 True/False。
        依次在当前页、50条/页第1页、第2~max_pages页中查找。"""
        tab = self._detail_tab
        js = """
        return !!document.querySelector('tr[data-row-key="' + arguments[0] + '"]');
        """
        # 1. 当前页找
        if tab.run_js(js, row_key):
            return True
        # 2. 调成50条/页（会回到第1页）再找
        self._set_page_size(50)
        time.sleep(0.2)
        if tab.run_js(js, row_key):
            return True
        # 3. 翻页查找（第2页到第max_pages页）
        for page in range(2, max_pages + 1):
            if not self._go_to_page(page):
                break  # 没有更多页了
            time.sleep(0.2)
            if tab.run_js(js, row_key):
                return True
        logger.warning("_ensure_row_visible: row_key=%s 未找到（翻了 %d 页）" % (row_key, max_pages))
        return False

    # ─── 分页控制 ───

    def _set_page_size(self, size=50):
        """
        修改表格每页显示条数（10/20/50）。
        操作后页面会回到第1页，行数立即变化。
        """
        tab = self._detail_tab
        if size not in (10, 20, 50):
            logger.warning("_set_page_size: 不支持的 size=%d，仅支持 10/20/50" % size)
            return False
        try:
            # 1. 点下拉框触发菜单
            tab.run_js("""
            var sel = document.querySelector('.pjt-next-antd-pagination-options .pjt-next-antd-select-selector');
            if (sel) { sel.dispatchEvent(new MouseEvent('mousedown', {bubbles: true})); sel.dispatchEvent(new MouseEvent('mouseup', {bubbles: true})); sel.click(); }
            """)
            time.sleep(0.1)
            # 2. 选对应选项
            r = tab.run_js("""
            var opt = document.querySelector('[role="option"][title="%d 条/页"]');
            if (opt) { opt.click(); return 'OK'; }
            return 'NOT_FOUND';
            """ % size)
            time.sleep(0.1)
            logger.info("_set_page_size: 改为 %d 条/页 → %s" % (size, r))
            return r == 'OK'
        except Exception as e:
            logger.warning("_set_page_size 异常: %s" % e)
            return False

    def _go_to_page(self, page):
        """
        跳转到指定页码。
        返回 True/False 表示是否成功。
        """
        tab = self._detail_tab
        try:
            r = tab.run_js("""
            var el = document.querySelector('li[title="%d"]');
            if (el) { el.click(); return 'OK'; }
            return 'NOT_FOUND';
            """ % page)
            time.sleep(0.1)
            return r == 'OK'
        except Exception as e:
            logger.warning("_go_to_page 异常: %s" % e)
            return False

    def _get_current_page(self):
        """获取当前页码"""
        try:
            r = self._detail_tab.run_js(
                "return document.querySelector('.pjt-next-antd-pagination-item-active')?.textContent || '';"
            )
            return int(r) if r and r.strip().isdigit() else None
        except:
            return None

    def _get_total_pages(self):
        """获取总页数"""
        try:
            r = self._detail_tab.run_js("""
            var txt = document.querySelector('.pjt-next-antd-pagination-total-text');
            if (!txt) return '';
            var m = txt.textContent.match(/\\/\\s*(\\d+)\\s*页/);
            return m ? m[1] : '';
            """)
            return int(r) if r and r.strip().isdigit() else None
        except:
            return None

    def _get_cluster_no(self, row_key):
        """获取 clusterNo（从行数据属性或DOM中取）"""
        return self._detail_tab.run_js("""
        var tr = document.querySelector('tr[data-row-key="' + arguments[0] + '"]');
        if (!tr) return null;
        var ck = tr.getAttribute('data-cluster-key');
        if (ck) return ck;
        var rk = tr.getAttribute('data-row-key');
        if (rk && rk.startsWith('20101')) return '20102' + rk.substring(5);
        return rk;
        """, row_key)

    def _get_api_origin(self):
        """从页面 resource entries 中获取 API 的基础 origin"""
        tab = self._detail_tab
        origin = tab.run_js("""
        var entries = performance.getEntriesByType('resource');
        for (var i = entries.length - 1; i >= 0; i--) {
            if (entries[i].name.includes('recycler-api')) {
                return new URL(entries[i].name).origin;
            }
        }
        return 'https://sjapi-h5.aihuishou.com';
        """)
        return origin or 'https://sjapi-h5.aihuishou.com'

    def _bid_via_api(self, goodsNo, clusterNo, quotationDocumentNo, price, ignore_warning=True):
        """
        直接调 quote API 出价（最快）。
        ignore_warning=True 跳过"偏高确认"弹窗。
        返回 dict: {ok: bool, code: int, msg: str}
        """
        tab = self._detail_tab
        api_origin = self._get_api_origin()
        body = json.dumps({
            "quotationDocumentNo": quotationDocumentNo,
            "clusterNo": clusterNo,
            "goodsNo": goodsNo,
            "quotedPrice": price,
            "ignoreWarning": ignore_warning,
            "isNewRecyclerCanCanalPrice": True
        })
        r = tab.run_js("""
        return (async function() {
            try {
                var resp = await fetch(arguments[0] + '/recycler-api/recycler/common-document/goods/quote', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    credentials: 'include',
                    body: arguments[1]
                });
                var data = await resp.text();
                try {
                    var j = JSON.parse(data);
                    return JSON.stringify({ok: j.code === 200, code: j.code, msg: j.resultMessage || ''});
                } catch(e) {
                    return JSON.stringify({ok: false, code: -1, msg: data.substring(0, 200)});
                }
            } catch(e) {
                return JSON.stringify({ok: false, code: -1, msg: e.message});
            }
        })(arguments[0], arguments[1]);
        """, api_origin, body)
        time.sleep(0.1)
        try:
            return json.loads(r)
        except:
            return {"ok": False, "code": -1, "msg": r}

    # ═══════════════════════════════════════════
    #  模拟点击出价（通用内核）
    # ═══════════════════════════════════════════

    @staticmethod
    def _click_bid_button(tab, row_key):
        """
        点击指定行的操作按钮（出价/改价）。
        返回 {ok: bool, action: str}  action="出价"|"改价"
        """
        r = tab.run_js("""
        var tr = document.querySelector('tr[data-row-key="' + arguments[0] + '"]');
        if (!tr) return JSON.stringify({ok: false, action: '', msg: 'ROW_NOT_FOUND'});
        var tds = tr.querySelectorAll('td');
        var td3 = tds[3];
        if (!td3) return JSON.stringify({ok: false, action: '', msg: 'NO_TD3'});
        var btn = td3.querySelector('button');
        if (!btn) return JSON.stringify({ok: false, action: '', msg: 'NO_BTN'});
        var action = btn.textContent.trim();
        btn.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
        return JSON.stringify({ok: true, action: action});
        """, row_key)
        try: return json.loads(r)
        except: return {"ok": False, "action": "", "msg": r}

    @staticmethod
    def _fill_price(tab, price):
        """
        往当前展开的 .pjt-next-antd-input-number-input 填价格。
        React 受控组件用原生 setter + 事件触发。
        """
        fill_js = """
        (function(priceVal) {
            var inp = document.querySelector('.pjt-next-antd-input-number-input');
            if (!inp) return 'NO_INPUT';
            var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            ).set;
            nativeInputValueSetter.call(inp, String(priceVal));
            inp.dispatchEvent(new Event('input', {bubbles: true}));
            inp.dispatchEvent(new Event('change', {bubbles: true}));
            var tracker = inp._valueTracker;
            if (tracker) tracker.setValue(String(priceVal));
            return 'SET:' + inp.value;
        })(""" + str(price) + """);
        """
        return tab.run_js(fill_js)

    @staticmethod
    def _click_save(tab, row_key):
        """点击行内"保存"按钮。返回 'SAVED' 或错误消息"""
        return tab.run_js("""
        var tr = document.querySelector('tr[data-row-key="' + arguments[0] + '"]');
        if (!tr) return 'ROW_NOT_FOUND';
        var all = tr.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
            if (all[i].textContent.trim() === '保存') {
                all[i].dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
                return 'SAVED';
            }
        }
        return 'NO_SAVE_BTN';
        """, row_key)

    @staticmethod
    def _get_page_msg(tab):
        """获取页面弹出消息。优先检测 modal 弹窗（需操作），再查 toast 消息。"""
        return tab.run_js("""
        var modal = document.querySelector(
          '.pjt-next-antd-modal-confirm-body, .ant-modal-confirm-body'
        );
        if (modal) return 'MODAL:' + modal.textContent.trim().substring(0, 200);
        var msgs = document.querySelectorAll(
          '.ant-message-notice, .pjt-next-antd-message-notice'
        );
        if (msgs.length) return msgs[msgs.length-1].textContent.trim().substring(0, 200);
        return '';
        """)

    @staticmethod
    def _confirm_dialog(tab):
        """如果有确认弹窗，点"确认/确定"按钮。返回结果字符串用于日志。"""
        r = tab.run_js("""
        var btnBox = document.querySelector('.pjt-next-antd-modal-confirm-btns, .ant-modal-confirm-btns');
        if (!btnBox) return 'no_modal';
        var btns = btnBox.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            var t = btns[i].textContent.replace(/\\s/g, '');
            if (t === '确认' || t === '确定') {
                btns[i].dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
                return 'confirm_clicked';
            }
        }
        return 'no_confirm_btn';
        """)
        return r

    # ═══════════════════════════════════════════
    #  出价核心方法
    # ═══════════════════════════════════════════

    def bid_once(self, price=1, row_key=None, auto_confirm=True, max_pages=2):
        """
        模拟点击出价/改价：点按钮→填价→保存→（确认弹窗）
        优先拦截 goods/quote API 响应判断 code==200，API 没抓到时回退 DOM 白名单。

        :param row_key:      data-row-key 属性值（goodsNo）
        :param auto_confirm: 偏高确认弹窗时自动点确认（默认 True）
        :param max_pages:    找不到行时最多翻页页数（默认2）
        :return:             True 表示出价成功
        """
        tab = self._detail_tab
        if not row_key:
            logger.warning("bid_once: 缺少 row_key")
            return False
        if not self._ensure_row_visible(row_key, max_pages=max_pages):
            logger.warning("bid_once: row_key=%s 未找到" % row_key)
            return False

        # 1. 点按钮
        r = self._click_bid_button(tab, row_key)
        if not r.get("ok"):
            logger.warning("bid_once 点按钮失败: %s" % r.get("msg", ""))
            return False
        action = r.get("action", "")
        logger.info("bid_once row_key=%s action=%s price=¥%d" % (row_key, action, price))
        time.sleep(0.1)

        # 2. 填值
        if self._fill_price(tab, price) == "NO_INPUT":
            logger.warning("bid_once 找不到输入框")
            return False
        time.sleep(0.1)

        # 3. 监听出价API → 点保存
        tab.listen.start('goods/quote')
        if self._click_save(tab, row_key) != "SAVED":
            logger.warning("bid_once 保存失败")
            return False
        logger.info("bid_once 已点保存按钮")

        # 4. 等待API响应
        api_resp = self._wait_quote_resp(tab)

        # code=551（偏高确认）→ 点确认 → 等第二次API
        if api_resp and api_resp.get("code") == 551:
            if auto_confirm:
                time.sleep(0.1)
                cr = self._confirm_dialog(tab)
                logger.info("bid_once 偏高弹窗→点确认: %s" % cr)
                time.sleep(0.1)
                api_resp = self._wait_quote_resp(tab)
            else:
                logger.warning("bid_once ¥%d 偏高弹窗未确认" % price)
                return False

        # 5. 解析API结果
        if api_resp:
            code = api_resp.get("code")
            msg = api_resp.get("resultMessage", "")
            if code == 200:
                logger.info("bid_once ¥%d row_key=%s ✅ API code=200" % (price, row_key))
                return True
            logger.warning("bid_once ¥%d row_key=%s ❌ API code=%s msg=%s" % (price, row_key, code, msg[:60]))
            return False

        # 6. 没抓到API响应 → 回退到DOM消息轮询（白名单：必须含成功关键词）
        logger.warning("bid_once 未抓到API响应，回退DOM消息轮询")
        tab.run_js("""
        var old = document.querySelectorAll('.ant-message-notice, .pjt-next-antd-message-notice');
        for (var i = 0; i < old.length; i++) old[i].remove();
        """)
        for _ in range(15):
            time.sleep(0.2)
            msg = self._get_page_msg(tab)
            if not msg:
                continue
            if msg.startswith("MODAL:"):
                if auto_confirm:
                    cr = self._confirm_dialog(tab)
                    logger.info("bid_once 偏高弹窗→点确认: %s" % cr)
                    continue
                return False
            # 白名单：只有含成功关键词才算成功，其他一律失败
            if any(k in msg for k in ['成功', '已提交', '已完成']):
                logger.info("bid_once 页面消息(成功): %s" % msg)
                return True
            logger.warning("bid_once ¥%d row_key=%s ❌ %s" % (price, row_key, msg))
            return False

        logger.warning("bid_once ¥%d row_key=%s ⏰ 轮询超时未收到结果" % (price, row_key))
        return False

    # ═══════════════════════════════════════════
    #  拦截API版 二分法找最高价
    # ═══════════════════════════════════════════

    @staticmethod
    def _collapse_row(tab, row_key):
        """行展开态 → 点"取消"折叠"""
        return tab.run_js("""
        var tr = document.querySelector('tr[data-row-key="' + arguments[0] + '"]');
        if (!tr) return 'ROW_NOT_FOUND';
        var all = tr.querySelectorAll('td')[3].querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
            if (all[i].textContent.trim() === '取消') {
                all[i].dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
                return 'COLLAPSED';
            }
        }
        return 'NO_CANCEL_BTN';
        """, row_key)

    def _try_price(self, row_key, price):
        """
        模拟点击出价，拦截 API 响应判断结果（比等DOM消息快）。
        返回 {"ok": bool, "msg": str, "code": int, "is_limit": bool}
        """
        tab = self._detail_tab

        # 折叠 → 点按钮 → 填价
        self._collapse_row(tab, row_key)
        time.sleep(0.1)
        r = self._click_bid_button(tab, row_key)
        if not r.get("ok"):
            return {"ok": False, "msg": "btn: " + r.get('msg',''), "code": -1, "is_limit": False}
        time.sleep(0.1)
        self._fill_price(tab, price)
        time.sleep(0.1)

        # 监听出价API → 点保存
        tab.listen.start('goods/quote')
        saved = self._click_save(tab, row_key)
        if saved != "SAVED":
            return {"ok": False, "msg": "save: " + str(saved), "code": -2, "is_limit": False}

        # 首次API响应（可能是 code=551 偏高）
        api_resp = self._wait_quote_resp(tab)

        # code=551（偏高确认）→ 点确认 → 等第二次API
        if api_resp and api_resp.get("code") == 551:
            time.sleep(0.1)
            self._confirm_dialog(tab)
            time.sleep(0.1)
            api_resp = self._wait_quote_resp(tab)


        # 解析API结果
        if api_resp:
            code = api_resp.get("code")
            msg = api_resp.get("resultMessage", "")
            if code == 200:
                return {"ok": True, "msg": "OK", "code": 200, "is_limit": False}
            is_limit = any(k in msg for k in ['超出', '限制', '上限', '最高'])
            self._collapse_row(tab, row_key)
            return {"ok": False, "msg": msg[:60], "code": code, "is_limit": is_limit}

        # 没抓到API响应 → 回退到DOM消息
        msg = self._get_page_msg(tab)
        self._collapse_row(tab, row_key)
        if any(k in msg for k in ['超出', '限制', '上限']):
            return {"ok": False, "msg": msg[:80], "code": 0, "is_limit": True}
        if msg:
            return {"ok": False, "msg": msg[:80], "code": 0, "is_limit": False}
        return {"ok": False, "msg": "超时", "code": 0, "is_limit": False}

    def bid_max_price(self, row_key=None, start_price=None, document_no=None, max_pages=2):
        """
        参考起拍价，用二分法找到能出价的最高价。

        :param row_key:      data-row-key 属性值（goodsNo）
        :param start_price:  起拍价（None 自动从页面取）
        :param document_no:  竞价单号（None 自动从URL提取）
        :param max_pages:    找不到行时最多翻页页数（默认2）
        :return: {"max_price": int, "ok": bool, "msg": str}
        """
        tab = self._detail_tab
        if self._find_slider(tab)[0]:
            logger.warning("bid_max_price: 检测到滑块，先处理...")
            self.handle_captcha(tab)

        if not row_key:
            return {"max_price": 0, "ok": False, "msg": "缺少 row_key"}
        if not self._ensure_row_visible(row_key, max_pages=max_pages):
            return {"max_price": 0, "ok": False, "msg": "row_key=%s 未找到" % row_key}
        goodsNo = row_key

        # 取竞价单号
        if not document_no:
            document_no = tab.run_js("""
            var m = window.location.href.match(/documentNo=([A-Z0-9]+)/);
            return m ? m[1] : null;
            """)
        if not document_no:
            return {"max_price": 0, "ok": False, "msg": "无法获取竞价单号"}
        quotationDocumentNo = document_no

        clusterNo = self._get_cluster_no(row_key)

        # 取起拍价
        if start_price is None:
            sp = tab.run_js("""
            var tr = document.querySelector('tr[data-row-key="' + arguments[0] + '"]');
            if (!tr) return 0;
            var tds = tr.querySelectorAll('td');
            var txt = tds[1] ? tds[1].textContent.trim().replace(/[\\uFFE5,¥,\\s]/g, '') : '0';
            return parseFloat(txt) || 0;
            """, row_key)
            try: start_price = float(sp)
            except: start_price = 0

        if start_price <= 0:
            return {"max_price": 0, "ok": False, "msg": "起拍价无效"}

        logger.info("bid_max_price: row_key=%s start=¥%.0f" % (row_key, start_price))

        # ── 策略1：快速 fetch API ──
        test = self._bid_via_api(goodsNo, clusterNo, quotationDocumentNo, int(start_price))
        if test.get("ok") or test.get("code") == 10003049:
            logger.info("API 出价可用，使用快速二分法")
            return self._bid_max_price_api(goodsNo, clusterNo, quotationDocumentNo, int(start_price))

        # ── 策略2：模拟点击+拦截API ──
        logger.info("API 出价不可用(code=%s)，回退到模拟点击+拦截API" % test.get("code"))
        return self._bid_max_price_intercept(row_key, int(start_price))

    @staticmethod
    def _wait_quote_resp(tab, rounds=8, timeout=0.5):
        """等 goods/quote API 响应，返回解析后的 dict 或 None"""
        for _ in range(rounds):
            p = tab.listen.wait(timeout=timeout)
            if p and p.response:
                body = p.response.body
                if isinstance(body, str):
                    try: body = json.loads(body[:10000])
                    except: pass
                if isinstance(body, dict) and 'code' in body:
                    return body
        return None

    def _find_upper_bound(self, try_fn, low):
        """从 low 开始 ×1.5 翻倍找上界，返回 (low, high, best)"""
        high = int(low * 1.5)
        best = low
        for _ in range(15):
            r = try_fn(high)
            if r.get("ok"):
                best = high
                low = high
            elif r.get("code") == 10003049:
                break
            else:
                break
            high = int(high * 1.5)
            if high > 200000:
                break
        return low, high, best

    @staticmethod
    def _binary_search_max(try_fn, low, high, best):
        """二分法在 [low, high] 区间找最高可行价。try_fn(price) -> {"ok": bool}"""
        for _ in range(25):
            mid = (low + high) // 2
            if mid <= low:
                break
            r = try_fn(mid)
            if r.get("ok"):
                best = mid
                low = mid
            else:
                high = mid
            if high - low <= 1:
                break
        return best

    def _bid_max_price_api(self, goodsNo, clusterNo, quotationDocumentNo, start_price):
        """
        快速二分法（直接调 fetch API）。
        自动判断方向：起拍价可行则向上翻倍，已超限则指数下降找可行点。
        """
        low = int(start_price)
        best = low

        try_fn = lambda p: self._bid_via_api(goodsNo, clusterNo, quotationDocumentNo, p)

        # 先确定起拍价是否可行
        r0 = try_fn(low)

        if r0.get("ok"):
            # 起拍价可行 → 向上翻倍找上界
            logger.info("  ── 向上翻倍找上界 ──")
            low, high, best = self._find_upper_bound(try_fn, low)
        else:
            # 起拍价已超限 → 指数下降找可行价格
            logger.info("  ── 起拍价超限，向下搜索 ──")
            step = max(1, low // 4)
            found = False
            while low > 1:
                low = max(1, low - step)
                r = try_fn(low)
                if r.get("ok"):
                    found = True
                    best = low
                    high = min(start_price, int(low * 1.5))
                    break
                if low <= 1:
                    break
            if not found:
                logger.warning("  → 未找到可行价格")
                return {"max_price": 0, "ok": False, "msg": "起拍价已超限，向下未找到可行价格"}

        # 二分
        logger.info("  ── 二分 [%d, %d] ──" % (low, high))
        best = self._binary_search_max(try_fn, low, high, best)

        logger.info("  → 最高可出价: ¥%d (API)" % best)
        return {"max_price": best, "ok": True, "msg": ""}

    def _bid_max_price_intercept(self, row_key, start_price):
        """模拟点击+拦截API 二分法找最高价"""
        low = int(start_price)
        best = low

        # 翻倍找上界
        logger.info("  ── 翻倍找上界 ──")
        low, high, best = self._find_upper_bound(
            lambda p: self._try_price(row_key, p), low)

        # 二分
        logger.info("  ── 二分 [%d, %d] ──" % (low, high))
        best = self._binary_search_max(
            lambda p: self._try_price(row_key, p), low, high, best)

        logger.info("  → 最高可出价: ¥%d" % best)
        return {"max_price": best, "ok": True, "msg": ""}


# ── 全局单例（供保活等小功能复用） ──────────────────────────
_global_api = None

def get_global_api() -> "PageApi":
    """进程级单例：供登录保活等轻量功能复用，避免反复建标签页。

    注意：并发爬取/捡漏仍用各自实例（每个线程独立标签页），
    不要用本单例做并发操作。
    """
    global _global_api
    if _global_api is None:
        _global_api = PageApi()
    return _global_api





