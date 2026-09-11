FROM python:3.12-alpine

RUN apk add --no-cache docker-cli docker-cli-compose docker-compose bash unzip
WORKDIR /app
COPY docker/agent/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY docker/agent/app.py docker/agent/telemetry.py docker/agent/game_details.py /app/

EXPOSE 8081
CMD ["python", "/app/app.py"]
