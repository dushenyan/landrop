# ============================================================
# LanDrop — 统一命令入口
# 用法: make <target>      列表: make help
# ============================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help

# ---------- 可调参数 ----------
# 命令行可覆盖：make start PORT=4000 DATA_DIR=/tmp/landrop-data
NPM      ?= npm
PNPM     ?= pnpm
NODE     ?= node
PORT     ?= 6861
WEB_PORT ?= 6862
# 后端 config.js 用 Number() 解析，必须给字节数，不能写 10GB。
DATA_DIR ?= $(CURDIR)/data
MAX_FILE ?= 10737418240

# 终端里只显示局域网地址；内网不可用时明确提示，不回退到 localhost。
LAN_IP := $(shell cd server && $(NODE) --input-type=module -e "import { lanIPv4 } from './src/config.js'; console.log(lanIPv4())" 2>/dev/null)
ifeq ($(strip $(LAN_IP)),)
SERVER_URL := 未检测到局域网地址
WEB_URL    := 未检测到局域网地址
else
SERVER_URL := http://$(LAN_IP):$(PORT)
WEB_URL    := http://$(LAN_IP):$(WEB_PORT)
endif

# ---------- 派生变量（与后端环境变量对齐） ----------
export LANDROP_PORT := $(PORT)
export LANDROP_DATA_DIR := $(DATA_DIR)
export LANDROP_MAX_FILE := $(MAX_FILE)

# Makefile 后台服务的 PID 与日志（不入库）
RUN_DIR    ?= $(CURDIR)/.run
SERVER_PID := $(RUN_DIR)/server.pid
WEB_PID    := $(RUN_DIR)/web.pid
SERVER_LOG := $(RUN_DIR)/server.log
WEB_LOG    := $(RUN_DIR)/web.log
export VITE_WEB_PORT := $(WEB_PORT)

# ---------- 终端颜色（BSD echo 不解释转义，统一用 printf） ----------
C_RESET := \033[0m
C_BOLD  := \033[1m
C_DIM   := \033[2m

# ============================================================
# 1. 依赖
# ============================================================
.PHONY: install update-deps

install: ## 首次安装前后端依赖（web + server）
	@echo ""
	@echo "  📦 [1/2] 安装前端依赖 (web/)"
	cd web && $(PNPM) install
	@echo "  ✅ 前端依赖已安装: web/node_modules"
	@echo ""
	@echo "  📦 [2/2] 安装后端依赖 (server/)"
	cd server && $(NPM) install
	@echo "  ✅ 后端依赖已安装: server/node_modules"
	@echo ""
	@echo "  ✅ 依赖安装完成"
	@echo "     下一步: make build 构建前端，或 make dev 启动开发"
	@echo ""

update-deps: ## 更新前后端依赖到最新兼容版本
	@echo ""
	@echo "  ⬆️  [1/2] 更新前端依赖 (web/)"
	cd web && $(PNPM) update
	@echo "  ✅ 前端依赖已更新"
	@echo ""
	@echo "  ⬆️  [2/2] 更新后端依赖 (server/)"
	cd server && $(NPM) update
	@echo "  ✅ 后端依赖已更新"
	@echo ""
	@echo "  ✅ 依赖更新完成"
	@echo "     下一步: make check 校验，或 make build 重新构建"
	@echo ""

# ============================================================
# 2. 本地开发
# ============================================================
.PHONY: dev dev-server dev-web

dev: ## 同时启动前后端开发服务（前台运行，Ctrl+C 退出）
	@echo ""
	@echo "  🚀 启动前后端开发服务"
	@echo "     后端    : $(SERVER_URL)  (node --watch)"
	@echo "     前端    : $(WEB_URL)  (vite)"
	@echo "     前端代理: /api、/uploads、/socket.io → 本机后端端口 $(PORT)（vite 从 LANDROP_PORT 读取）"
	@echo "  前台运行，Ctrl+C 退出；也可分开执行 make dev-server 与 make dev-web"
	@echo ""
	@$(MAKE) dev-server & SERVER_PID=$$!; \
	 $(MAKE) dev-web & WEB_PID=$$!; \
	 trap 'kill $$SERVER_PID $$WEB_PID 2>/dev/null || true' INT TERM; \
	 wait

dev-server: ## 启动后端开发服务 (node --watch，前台运行)
	@echo ""
	@echo "  🖥️  后端开发服务 (node --watch)"
	@echo "     地址    : $(SERVER_URL)"
	@echo "     数据目录: $(DATA_DIR)"
	@echo "  前台运行，Ctrl+C 退出"
	@echo ""
	cd server && $(NPM) run dev

dev-web: ## 启动前端开发服务 (vite，代理到后端 PORT，前台运行)
	@echo ""
	@echo "  🌐 前端开发服务 (vite)"
	@echo "     地址    : $(WEB_URL)"
	@echo "     接口代理: /api、/uploads、/socket.io → 本机后端端口 $(PORT)"
	@echo "     提示    : 需先启动后端 (make dev-server)，否则接口请求会失败"
	@echo "  前台运行，Ctrl+C 退出"
	@echo ""
	cd web && $(PNPM) run dev

# ============================================================
# 3. 构建
# ============================================================
.PHONY: build

build: ## 构建前端产物 (tsc -b && vite build → web/dist)
	cd web && $(PNPM) run build
	@echo "  ✅ 前端产物已生成: web/dist（后端会自动托管）"

# ============================================================
# 4. 质量检查
# ============================================================
.PHONY: check typecheck

check: typecheck build ## 提交前检查：类型检查 + 构建校验

typecheck: ## 前端类型检查 (tsc -b)
	cd web && $(PNPM) exec tsc -b
	@echo "  ✅ 类型检查通过"

# ============================================================
# 5. 运行
# ============================================================
.PHONY: serve start start-fg serve-bg stop status logs

serve: build start-fg ## 构建前端并前台启动生产服务（Ctrl+C 退出）

start: ## 后台启动/重启前后端开发服务（PID/日志写入 .run/）
	@$(MAKE) stop >/dev/null 2>&1 || true
	@mkdir -p $(RUN_DIR)
	@echo ""
	@echo "  🚀 后台启动开发服务（已运行则先重启）"
	@echo "     后端: $(SERVER_URL)   日志: $(SERVER_LOG)"
	@echo "     前端: $(WEB_URL)  日志: $(WEB_LOG)"
	@(cd server; nohup node --no-warnings --watch src/index.js > $(SERVER_LOG) 2>&1 & echo $$! > $(SERVER_PID))
	@(cd web; nohup node node_modules/vite/bin/vite.js > $(WEB_LOG) 2>&1 & echo $$! > $(WEB_PID))
	@echo "  停止: make stop   状态: make status   日志: make logs"
	@echo ""

start-fg: ## 前台启动生产服务 (node --no-warnings src/index.js)
	@echo ""
	@echo "  🚀 生产服务 (node --no-warnings src/index.js)"
	@echo "     地址    : $(SERVER_URL)"
	@echo "     数据目录: $(DATA_DIR)"
	@echo "     前端产物: web/dist（需先 make build）"
	@echo "  前台运行，Ctrl+C 退出"
	@echo ""
	cd server && node --no-warnings src/index.js

serve-bg: build ## 构建并后台启动生产服务（已运行则先重启）
	@$(MAKE) stop >/dev/null 2>&1 || true
	@mkdir -p $(RUN_DIR)
	@echo ""
	@echo "  🚀 后台启动生产服务（已运行则先重启）"
	@echo "     地址: $(SERVER_URL)"
	@echo "     日志: $(SERVER_LOG)"
	@(cd server; nohup node --no-warnings src/index.js > $(SERVER_LOG) 2>&1 & echo $$! > $(SERVER_PID))
	@echo "  停止: make stop   状态: make status   日志: make logs"
	@echo ""

stop: ## 停止 Makefile 启动的后台服务
	@for pidfile in $(SERVER_PID) $(WEB_PID); do \
	  if test -f $$pidfile; then \
	    pid=$$(cat $$pidfile); \
	    if kill -0 $$pid 2>/dev/null; then kill $$pid && echo "  已停止 $$pid"; fi; \
	    rm -f $$pidfile; \
	  fi; \
	done
	@echo "  ✅ 后台服务已停止"

status: ## 查看后台服务状态
	@if test -f $(SERVER_PID) && kill -0 $$(cat $(SERVER_PID)) 2>/dev/null; then \
	  echo "  后端: 运行中 ($$(cat $(SERVER_PID)))"; \
	else echo "  后端: 未运行"; fi
	@if test -f $(WEB_PID) && kill -0 $$(cat $(WEB_PID)) 2>/dev/null; then \
	  echo "  前端: 运行中 ($$(cat $(WEB_PID)))"; \
	else echo "  前端: 未运行"; fi

logs: ## 跟踪前后端日志
	@tail -n 40 -f $(SERVER_LOG) $(WEB_LOG) 2>/dev/null || true

# ============================================================
# 6. 清理
# ============================================================
.PHONY: clean clean-all clean-data

clean: ## 删除前端构建产物（安全，默认清理命令）
	rm -rf web/dist
	@echo "  ✅ 已删除 web/dist，数据目录保持不变"

clean-all: clean ## 删除构建产物与前后端 node_modules（保留数据）
	@echo ""
	@echo "  🧹 删除前后端 node_modules"
	rm -rf web/node_modules server/node_modules
	@echo "  ✅ 依赖目录已删除（可用 make install 重装）"
	@echo "     用户数据未删除；如需删除请用 make clean-data"
	@echo ""

clean-data: ## ⚠️ 危险：删除数据目录（数据库与所有上传文件，不可恢复）
	@echo ""
	@echo "  ⚠️  [1/1] 删除数据目录 $(DATA_DIR)"
	@echo "     包含 SQLite 数据库、tus 临时文件、原文件与缩略图，删除后不可恢复"
	@test -n "$(DATA_DIR)" && test "$(DATA_DIR)" != "/" && test "$(DATA_DIR)" != "." || { echo "  ❌ 拒绝删除: 数据目录为空或为根目录"; exit 1; }
	rm -rf $(DATA_DIR)
	@echo "  ✅ 数据目录已删除；下次启动会创建空库"
	@echo "     日常清理请用 make clean 或 make clean-all（均不碰数据）"
	@echo ""

# ============================================================
# 7. 帮助
# ============================================================
.PHONY: help

help: ## 按分类显示所有命令
	@printf '%b\n' "  $(C_BOLD)LanDrop — 统一命令入口$(C_RESET)"
	@printf '%b\n' "  $(C_DIM)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(C_RESET)"
	@printf '%b\n' ""
	@awk 'BEGIN {FS = "## "} \
	  /^# [0-9]+\./ { sub(/^# [0-9]+\. /, ""); if (c++) printf "\n"; printf "  \033[1m%s\033[0m\n", $$0 } \
	  /^[a-zA-Z0-9_-]+:.*## ?/ { n=$$1; sub(/:.*/, "", n); printf "    \033[1;32m%-15s\033[0m%s\n", n, $$2 }' $(MAKEFILE_LIST)
	@printf '%b\n' ""
