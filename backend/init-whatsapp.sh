#!/bin/bash
# init-whatsapp.sh - Script de inicialização do WhatsApp Web
# Coloque este arquivo na RAIZ do projeto backend

echo "========================================"
echo "🔄 CONFIGURANDO AMBIENTE WHATSAPP WEB"
echo "========================================"

# ============================================================================
# CONFIGURAÇÕES DE VARIÁVEIS DE AMBIENTE
# ============================================================================
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true"
export NODE_ENV="production"

# ============================================================================
# 1. ENCONTRAR O CHROMIUM NO SISTEMA NIX
# ============================================================================
echo "🔍 Procurando Chromium no sistema..."

# Possíveis caminhos do Chromium no Nix
POSSIBLE_PATHS=(
  "/nix/var/nix/profiles/default/bin/chromium"
  "/run/current-system/sw/bin/chromium"
  "/usr/bin/chromium"
  "/usr/bin/chromium-browser"
  "$(find /nix/store -name 'chromium' -type f -executable 2>/dev/null | head -1)"
  "$(which chromium 2>/dev/null)"
  "$(which chromium-browser 2>/dev/null)"
)

CHROMIUM_PATH=""
for path in "${POSSIBLE_PATHS[@]}"; do
  if [ -f "$path" ] && [ -x "$path" ]; then
    CHROMIUM_PATH="$path"
    echo "✅ Chromium encontrado em: $path"
    break
  fi
done

if [ -z "$CHROMIUM_PATH" ]; then
  echo "❌ Chromium não encontrado nos caminhos padrão!"
  echo "⚠️  O WhatsApp pode não funcionar corretamente."
  echo "💡 Tentando instalar via nix-env..."
  
  # Tentar instalar Chromium
  if command -v nix-env &> /dev/null; then
    echo "📦 Instalando Chromium via nix-env..."
    nix-env -i chromium 2>/dev/null || true
    
    # Verificar novamente
    NEW_PATH="/nix/var/nix/profiles/default/bin/chromium"
    if [ -f "$NEW_PATH" ]; then
      CHROMIUM_PATH="$NEW_PATH"
      echo "✅ Chromium instalado em: $CHROMIUM_PATH"
    fi
  fi
fi

if [ -n "$CHROMIUM_PATH" ]; then
  export CHROMIUM_PATH="$CHROMIUM_PATH"
  export PUPPETEER_EXECUTABLE_PATH="$CHROMIUM_PATH"
  
  # Testar versão do Chromium
  echo "📏 Testando versão do Chromium..."
  if $CHROMIUM_PATH --version &>/dev/null; then
    VERSION=$($CHROMIUM_PATH --version 2>/dev/null | head -n1)
    echo "✅ Chromium versão: $VERSION"
  else
    echo "⚠️  Não foi possível obter versão do Chromium"
  fi
else
  echo "❌❌ ATENÇÃO: Chromium não disponível!"
  echo "O WhatsApp Web NÃO funcionará sem Chromium."
fi

# ============================================================================
# 2. CONFIGURAR DIRETÓRIOS DE SESSÃO
# ============================================================================
echo ""
echo "📁 Configurando diretórios de sessão..."

SESSION_DIRS=(
  "/tmp/whatsapp-sessions"
  "/app/tmp/sessions"
  "/tmp/wweb_sessions"
)

for dir in "${SESSION_DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    echo "📂 Criando diretório: $dir"
    mkdir -p "$dir"
  fi
  
  # Verificar permissões
  if [ -w "$dir" ]; then
    echo "✅ Diretório $dir está gravável"
    export WHATSAPP_SESSION_DIR="$dir"
    break
  else
    echo "⚠️  Diretório $dir não é gravável, tentando corrigir permissões..."
    chmod 777 "$dir" 2>/dev/null || true
  fi
done

# ============================================================================
# 3. VERIFICAR DEPENDÊNCIAS DO SISTEMA
# ============================================================================
echo ""
echo "🔧 Verificando dependências do sistema..."

# Bibliotecas críticas para o Chromium
CRITICAL_LIBS=(
  "libglib-2.0.so.0"
  "libnss3.so"
  "libX11.so.6"
  "libxcb.so.1"
  "libgbm.so.1"
  "libasound.so.2"
)

MISSING_LIBS=0
for lib in "${CRITICAL_LIBS[@]}"; do
  if ldconfig -p | grep -q "$lib"; then
    echo "✅ $lib encontrada"
  else
    echo "❌ $lib NÃO encontrada"
    MISSING_LIBS=$((MISSING_LIBS + 1))
  fi
done

if [ $MISSING_LIBS -gt 0 ]; then
  echo "⚠️  $MISSING_LIBS biblioteca(s) crítica(s) faltando!"
  echo "💡 Isso pode causar problemas no WhatsApp."
fi

# ============================================================================
# 4. CONFIGURAR LIMITES DO SISTEMA
# ============================================================================
echo ""
echo "⚙️  Ajustando limites do sistema..."

# Aumentar limites para o Node.js/Puppeteer
ulimit -n 65535 2>/dev/null || true
ulimit -u 65535 2>/dev/null || true

# Configurar variáveis do Node.js
export NODE_OPTIONS="--max-old-space-size=4096 --max-http-header-size=16384"

# ============================================================================
# 5. VERIFICAR SE O BUILD FOI FEITO
# ============================================================================
echo ""
echo "📦 Verificando build da aplicação..."

if [ ! -d "dist" ] || [ ! -f "dist/server.js" ]; then
  echo "⚠️  Build não encontrado. Executando npm run build..."
  
  # Tentar fazer o build
  if command -v npm &> /dev/null; then
    npm run build 2>&1 | tail -20
    if [ $? -eq 0 ] && [ -f "dist/server.js" ]; then
      echo "✅ Build realizado com sucesso!"
    else
      echo "❌ Falha no build!"
      exit 1
    fi
  else
    echo "❌ NPM não encontrado!"
    exit 1
  fi
else
  echo "✅ Build encontrado em dist/server.js"
fi

# ============================================================================
# 6. LOG DE CONFIGURAÇÃO FINAL
# ============================================================================
echo ""
echo "========================================"
echo "✅ CONFIGURAÇÃO FINAL"
echo "========================================"
echo "📅 Data/Hora: $(date)"
echo "🐍 Node.js: $(node --version 2>/dev/null || echo 'Não encontrado')"
echo "📦 NPM: $(npm --version 2>/dev/null || echo 'Não encontrado')"
echo "🌍 NODE_ENV: $NODE_ENV"
echo "🖥️  CHROMIUM_PATH: ${CHROMIUM_PATH:-'NÃO DEFINIDO'}"
echo "📁 SESSION_DIR: ${WHATSAPP_SESSION_DIR:-'/tmp/whatsapp-sessions'}"
echo "💾 Memória disponível: $(free -h | awk '/^Mem:/ {print $2}')"
echo "========================================"
echo ""

# ============================================================================
# 7. INICIAR A APLICAÇÃO
# ============================================================================
echo "🚀 Iniciando backend Whaticket..."
echo "📡 Servidor na porta: ${PORT:-3000}"
echo "========================================"

# Verificar se estamos em modo de depuração
if [ "$DEBUG_MODE" = "true" ]; then
  echo "🐛 MODO DEBUG ATIVADO"
  echo "🔧 Variáveis de ambiente:"
  env | grep -E "(NODE|CHROMIUM|PUPPETEER|DEBUG)" | sort
  echo ""
  exec node --inspect=0.0.0.0:9229 dist/server.js
else
  exec node dist/server.js
fi
