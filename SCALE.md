# Two servers behind a load balancer

## What we're going to do

In [DEPLOY.md](DEPLOY.md) you ran Stagepass on one server. Now you'll run it on **two servers** and put a **load balancer** in front of them, on the same cloud provider.

Users visit one address, the load balancer's. It sends each request to one of your servers, and stops sending traffic to a server that goes down.

By the end you will have:

1. A second server running the same app
2. Both servers sharing one database
3. A load balancer spreading requests across both servers
4. Watched the load balancer route around a server you stopped

You'll keep using your server from DEPLOY.md. If you deleted it, go through DEPLOY.md again first. It takes about 10 minutes.

## Why not just copy the server?

The fastest idea is to make a second server exactly like the first: Nginx, API, and its own database. That breaks in two ways:

- **Two databases means two different sets of data.** You book seats through server 1, the load balancer sends your next request to server 2, and your tickets are gone. Worse, the row lock that stops two people from buying the same seat only works inside one database. Two people on two servers can both buy seat A1.
- **Two login secrets means random logouts.** The API signs your login cookie with a secret (`JWT_SECRET`). If each server has its own secret, a cookie from server 1 is invalid on server 2. You'd be logged in on one request and logged out on the next.

The rule: **app servers keep no state of their own.** Data lives in one shared database, and every server uses the same secret. Then it doesn't matter which server answers a request.

So server 2 runs only Nginx and the API. Its API connects to the database on server 1 over the cloud's **private network**, the internal network your servers share inside the cloud, which the internet can't reach.

## The setup

```mermaid
flowchart LR
    Browser["Browser<br/>(your laptop)"] --> LB["Load balancer<br/>public address"]
    subgraph net["Private network: AWS VPC, Azure VNet, or Google Cloud VPC"]
        subgraph s1["Server 1 (from DEPLOY.md)"]
            N1["Nginx"] --> A1["Node API"] --> DB[("PostgreSQL")]
        end
        subgraph s2["Server 2 (new, no database)"]
            N2["Nginx"] --> A2["Node API"]
        end
    end
    LB --> N1
    LB --> N2
    A2 -. "port 5432" .-> DB
```

- **Server 1** keeps running everything it ran before, and also lets server 2 use its database.
- **Server 2** runs Nginx and the API. Its API reads and writes to the database on server 1.
- **The load balancer** is the only address users visit. It sends each request to server 1 or server 2.

## What a load balancer does

A load balancer is a server your cloud provider runs for you. It has a public address and a list of your servers behind it. It does two jobs:

1. **Spreads requests.** Each incoming request goes to one of the servers in the list, usually taking turns. Two servers share the work, and you can add a third when two aren't enough.
2. **Checks health.** Every few seconds it calls `/api/health` on each server. That endpoint answers only if the API is running and can reach the database. A server that fails the check a few times in a row gets no more traffic until it passes again.

It's the same idea as Nginx in DEPLOY.md, one entry point that forwards requests, except it forwards to whole servers instead of to a process on the same machine.

The app code doesn't change for this. Two reasons:

- The login cookie is a signed token. The server doesn't keep sessions in memory, so any server with the same secret can check it.
- The job that releases expired seat holds runs on both servers. That's safe, because it updates the rows inside a transaction and a hold can only be released once.

## Same thing, different names

| What it is | AWS | Azure | Google Cloud |
| --- | --- | --- | --- |
| Load balancer | Application Load Balancer (ALB) | Load Balancer (Standard) | Application Load Balancer |
| List of servers behind it | Target group | Backend pool | Instance group + backend service |
| Health check | Target group health check | Health probe | Health check |
| Private network | VPC (the default one) | Virtual network (VNet) | VPC network (`default`) |
| Server's private address | Private IPv4 address | Private IP address | Internal IP |

Left running for a whole month, a second server and a load balancer cost roughly $20 to $30, depending on the cloud. Your free credits cover that, and you only need them running for an hour or two, so delete everything at the end.

---

## Step 1. Let server 1 share its database

SSH into **server 1** and run:

```bash
cd /opt/stagepass
sudo git pull
sudo ./deploy/setup.sh
sudo ./deploy/share-database.sh
```

The first three commands update server 1 to the latest code, which adds a "Served by" line to the site so you can see which server answered. The last one does two things:

- Lets Postgres accept connections from private network addresses, with a password. Addresses from the public internet are still rejected.
- Prints one long command starting with `sudo /opt/stagepass/deploy/setup.sh --database-url`. **Copy it.** You'll run it on server 2. It contains the database password and the login secret, so don't post it anywhere.

**AWS only:** security groups block traffic between your own servers by default. Open EC2, **Security Groups**, the group your server uses (named like `launch-wizard-1`), **Edit inbound rules**, **Add rule**: type **PostgreSQL**, source **Custom**, and pick the same security group in the search box. Save. Now any server in this group can reach port 5432, and nothing else can.

**Azure and Google Cloud:** nothing to do. Servers in the same network can already reach each other (Azure's `AllowVnetInBound` rule, Google Cloud's `default-allow-internal` rule).

## Step 2. Create server 2

Create a second server the same way as in DEPLOY.md, name it `stagepass-2`, and change only what's listed for your cloud. It must be in the **same region and network** as server 1, or it can't reach the database.

### AWS: EC2

- **Region:** the same as server 1
- **Key pair:** pick the existing `stagepass` key, so you log in with the same `.pem` file
- **Network settings:** click **Select existing security group** and pick the one server 1 uses

### Azure: Virtual Machines

- **Resource group:** `stagepass-rg`, and the same region as server 1
- **Size:** the other free size. If server 1 is `B1s`, pick `B2ats_v2`, or the other way around. Each size gets its own 750 free hours a month, so both servers stay free
- **SSH public key source:** Use existing key stored in Azure, then pick the key from server 1
- **Networking** tab: **Virtual network** is server 1's network (named like `stagepass-vnet`). Keep HTTP (80) and SSH (22) open

### Google Cloud: Compute Engine

- **Region and zone:** exactly the same as server 1, for example `us-central1-a`. Both servers go into one instance group later, and an instance group lives in one zone
- Keep `e2-micro`, Ubuntu 24.04, the Standard persistent disk, and **Allow HTTP traffic**. Only one `e2-micro` is always free, so this one uses your trial credits

## Step 3. Install the app on server 2

SSH into **server 2** and run:

```bash
sudo git clone https://github.com/DeveloperMastery/stagepass.git /opt/stagepass
```

Then paste the command you copied in Step 1. It looks like this:

```bash
sudo /opt/stagepass/deploy/setup.sh --database-url 'postgres://stagepass:...@10.0.0.4:5432/stagepass' --jwt-secret '...'
```

This is the same setup script as before, but it skips installing Postgres and points the API at server 1's private IP instead. It ends with:

```
API is up: {"status":"ok","server":"stagepass-2"}
```

The `server` value is the machine's hostname. On AWS it looks like `ip-172-31-5-20`.

Open `http://<server-2-public-ip>` in your browser and log in as `customer@stagepass.dev` / `customer123`. The tickets you bought in DEPLOY.md are there, because server 2 reads the same database.

## Step 4. Create the load balancer

Follow the part for your cloud. Every version needs the same three things: **which servers** get traffic, **port 80** on each server, and a **health check** on `/api/health`.

### AWS: Application Load Balancer

First the target group, the list of servers:

1. In EC2, open **Target Groups** and click **Create target group**.
2. **Target type:** Instances. **Name:** `stagepass-tg`. **Protocol and port:** HTTP, 80. **VPC:** the default one.
3. **Health check path:** `/api/health`. Open **Advanced health check settings** and set **Healthy threshold** to `2` and **Interval** to `10` seconds. The defaults (5 checks, 30 seconds apart) take over 2 minutes to bring a server back. Click **Next**.
4. Select both servers, click **Include as pending below**, then **Create target group**.

Then the load balancer:

1. Open **Load Balancers**, click **Create load balancer**, then **Create** under Application Load Balancer.
2. **Name:** `stagepass-alb`. **Scheme:** Internet-facing. **IP address type:** IPv4.
3. **Network mapping:** the default VPC. Select at least two Availability Zones, and one of them must be the zone your servers are in.
4. **Security groups:** remove the default one and pick the group your servers use. It already allows HTTP from the internet.
5. **Listeners and routing:** HTTP, port 80, forward to `stagepass-tg`.
6. Click **Create load balancer**. Wait until its state is **Active**, about 3 minutes, and both targets in `stagepass-tg` show **Healthy**.

Your address is the load balancer's **DNS name**, like `stagepass-alb-123456789.us-east-1.elb.amazonaws.com`.

### Azure: Load Balancer

1. Search for **Load balancers** and click **Create**.
2. **Resource group:** `stagepass-rg`. **Name:** `stagepass-lb`. **Region:** the same as your servers. **SKU:** Standard. **Type:** Public. **Tier:** Regional.
3. **Frontend IP configuration:** click **Add a frontend IP configuration**, name it `frontend`, IPv4, and under Public IP address click **Create new** and name it `stagepass-lb-ip`. Save.
4. **Backend pools:** click **Add a backend pool**, name it `stagepass-pool`, pick your servers' virtual network, set **Backend Pool Configuration** to **NIC**, click **Add**, and select both servers. Save.
5. **Inbound rules:** click **Add a load balancing rule**. Name `http`, frontend `frontend`, backend pool `stagepass-pool`, protocol **TCP**, port **80**, backend port **80**.
6. Under **Health probe**, click **Create new**: protocol **HTTP**, port **80**, path `/api/health`. Save, then save the rule.
7. Click **Review + create**, then **Create**.

Your address is the load balancer's frontend IP. Open the load balancer and look under **Frontend IP configuration**.

### Google Cloud: Application Load Balancer

First the instance group, the list of servers:

1. In Compute Engine, open **Instance groups**, click **Create instance group**, then **New unmanaged instance group**.
2. **Name:** `stagepass-group`. **Zone:** your servers' zone. **Network:** `default`.
3. Under **VM instances**, add both servers.
4. **Port mapping:** click **Add port**, name `http`, port `80`. Click **Create**.

Then the load balancer:

1. Open **Network services**, **Load balancing**, then **Create load balancer**.
2. Pick **Application Load Balancer (HTTP/HTTPS)**, **Public facing (external)**, **global**, and continue to **Configure**. Name it `stagepass-lb`.
3. **Frontend configuration:** protocol HTTP, port 80. Click **Done**.
4. **Backend configuration:** create a backend service named `stagepass-backend`, backend type **Instance group**, protocol HTTP, named port `http`. Add `stagepass-group` as the backend with port `80`.
5. Under **Health check**, create one: name `stagepass-health`, protocol HTTP, port 80, request path `/api/health`. Turn off Cloud CDN. Click **Create**.
6. Leave **Routing rules** as they are and click **Create**.

Your address is the IP shown under **Frontend** on the load balancer's page. It can take 5 to 10 minutes before it starts answering. Until then you'll see errors, which is normal.

## Step 5. Test it

Open `http://<load-balancer-address>` in your browser. Click around and watch the **Served by** line at the bottom of the page. It switches between your two servers.

From a terminal on your laptop you can see it faster:

```bash
for i in 1 2 3 4 5 6; do curl -s http://<load-balancer-address>/api/health; echo; done
```

```
{"status":"ok","server":"stagepass"}
{"status":"ok","server":"stagepass-2"}
{"status":"ok","server":"stagepass"}
...
```

On Windows PowerShell, use `curl.exe` instead of `curl`.

### Book through the load balancer

Log in, reserve seats, and pay. Your requests land on both servers, but you stay logged in and your tickets are always there. That's the shared database and the shared secret at work.

### Run the race test through the load balancer

On server 1:

```bash
cd /opt/stagepass/api
npm run race-test -- --url http://<load-balancer-address>
```

The 50 requests for one seat now land on both servers, and exactly one still wins. The lock lives in the database, not in the server, so it works no matter how many servers you add.

### Take a server down

On server 2, stop the API:

```bash
sudo systemctl stop stagepass-api
```

Keep refreshing the site. For up to about 20 seconds some requests fail, until the health check marks server 2 as unhealthy. After that every request goes to server 1. In the cloud console, the target group, backend pool, or backend service shows server 2 as unhealthy. Start it again:

```bash
sudo systemctl start stagepass-api
```

Within about 20 seconds it passes the health check again and gets traffic. Once the load balancer has noticed, users never hit the stopped server.

## Adding a third server

Repeat Steps 2 and 3 for `stagepass-3`, using the same command from Step 1, then add it to the target group, backend pool, or instance group. Nothing else changes. This is what scaling out looks like.

## What's still fragile

You removed one single point of failure and kept another. If server 2 dies, server 1 keeps serving. If server 1 dies, the database goes with it and both servers stop working. That's why real setups move the database onto its own managed service, which you'll do later in the course.

---

## If something doesn't work

| What you see | What to do |
| --- | --- |
| `setup.sh` on server 2 says it can't connect to the database | Check that `share-database.sh` ran on server 1, that both servers are in the same network, and on AWS that the PostgreSQL rule from Step 1 is in the security group both servers use. |
| Targets show **Unhealthy** | Run `curl http://localhost/api/health` on that server. If it fails, check `sudo journalctl -u stagepass-api -n 50`. If it works, check the health check uses port 80 and path `/api/health`. |
| The load balancer address doesn't answer | AWS: the load balancer's security group must allow HTTP. Google Cloud: wait 10 minutes after creating it. Azure: check the load balancing rule uses port 80 on both sides. |
| **Served by** never changes | Only one server is healthy. Check the health status of both in the console. |
| You get logged out when the server changes | Server 2 has a different `JWT_SECRET`. Run the Step 1 command again on server 2. |

## When you're done, delete everything

A load balancer costs money every hour it exists, even with no traffic. Delete in this order:

- **AWS:** delete the load balancer, then the target group, then terminate both instances
- **Azure:** delete the `stagepass-rg` resource group. It removes the load balancer, both servers, their disks, and their IPs together
- **Google Cloud:** delete the load balancer (and its backend service and health check when it asks), then the instance group, then both VMs
