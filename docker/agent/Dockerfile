FROM python:3.12-alpine

RUN apk add --no-cache docker-cli bash
WORKDIR /app
COPY docker/agent/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY docker/agent/app.py /app/app.py

EXPOSE 8081
CMD ["python", "/app/app.py"]
