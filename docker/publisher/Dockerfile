FROM python:3.13-alpine
WORKDIR /app
COPY docker/publisher/publish.py /app/publish.py
USER 65534:65534
CMD ["python", "-u", "/app/publish.py"]
