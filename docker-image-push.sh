npm run buildprod
docker build -t sockbowl-ng .
docker tag sockbowl-ng:latest 339712961919.dkr.ecr.us-east-1.amazonaws.com/sockbowl-ng:latest
docker push 339712961919.dkr.ecr.us-east-1.amazonaws.com/sockbowl-ng:latest
