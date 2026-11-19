# syntax=docker/dockerfile:1.7
# VieNeu narration sidecar (tools/vieneu/sidecar.py). CPU only, no GPU.
# Build context is tools/vieneu, not the repo root (the root .dockerignore
# leaves tools/ out of the app images):
#   docker build -f infra/docker/vieneu.Dockerfile -t nhipbut-vieneu tools/vieneu
#
# The model (~580 MB) is not baked in: it downloads from Hugging Face on the
# first start into /models, a volume, so rebuilding the image does not fetch
# it again and the image stays small enough to push.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    HF_HOME=/models \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then \
      cat /etc/ssl/certs/ca-certificates.crt /run/secrets/extra_ca > /tmp/ca.pem; \
      export PIP_CERT=/tmp/ca.pem; \
    fi \
  && pip install --no-cache-dir --timeout 120 --retries 10 -r requirements.txt \
  && rm -f /tmp/ca.pem
COPY sidecar.py .
RUN useradd --create-home vieneu && mkdir -p /models && chown vieneu /models
USER vieneu
EXPOSE 5063
# Loading the model takes about a minute, longer on the first start while it
# downloads; the API treats VieNeu as absent until this passes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:5063/healthz', timeout=4).status == 200 else 1)"
CMD ["python", "sidecar.py", "--host", "0.0.0.0", "--port", "5063"]
