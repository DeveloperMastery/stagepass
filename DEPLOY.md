# Deploy Stagepass to one cloud server

You'll rent one virtual server, install the whole app on it (frontend, API, database), and open it in your browser. Pick the cloud you signed up for. The steps are the same idea on all three, only the names change.

## Same thing, different names

| What it is | AWS | Azure | Google Cloud |
| --- | --- | --- | --- |
| Virtual server | EC2 instance | Virtual Machine (VM) | Compute Engine VM instance |
| Firewall that decides which ports are open | Security group | Network security group (NSG) | VPC firewall rule |
| Key you log in with | Key pair (`.pem` file) | SSH key pair (`.pem` file) | Handled for you by the browser SSH button |
| The server's internet address | Public IPv4 address | Public IP address | External IP |
| Default login user on Ubuntu | `ubuntu` | `azureuser` (you pick it) | your Google username |
| Free-tier size to pick | `t3.micro` | `B1s` or `B2ats v2` | `e2-micro` |

All three free-tier sizes have about 1 GB of RAM. That's enough for this app.

## What you're building

One Ubuntu server running three programs:

- **Nginx** on port 80, open to the internet. Serves the React app and forwards `/api` requests to the API.
- **Node.js API** on port 3000, only reachable from inside the server.
- **PostgreSQL** on port 5432, only reachable from inside the server.

So the only ports you open in the cloud firewall are **22** (SSH, for you to log in) and **80** (HTTP, for the browser).

---

## Step 1. Create the server

Follow the section for your cloud, then go to Step 2.

### AWS (EC2)

1. Open the **EC2** console and pick a region near you (top right).
2. Click **Launch instance**.
3. **Name:** `stagepass`
4. **Application and OS Images:** Ubuntu, then **Ubuntu Server 24.04 LTS**.
5. **Instance type:** `t3.micro` (marked "Free tier eligible").
6. **Key pair:** click **Create new key pair**, name it `stagepass`, type RSA, format `.pem`. It downloads a file. Keep it, you can't download it again.
7. **Network settings:** check **Allow SSH traffic** and **Allow HTTP traffic from the internet**. This creates the security group.
8. **Storage:** leave the default.
9. Click **Launch instance**, then open the instance and copy its **Public IPv4 address**.

### Azure (Virtual Machines)

1. Open the Azure portal, search for **Virtual machines**, click **Create**, then **Azure virtual machine**.
2. **Resource group:** click **Create new**, name it `stagepass-rg`. Everything for this server goes in it, which makes cleanup one click later.
3. **Virtual machine name:** `stagepass`
4. **Region:** one near you.
5. **Image:** **Ubuntu Server 24.04 LTS, x64 Gen2**.
6. **Size:** click **See all sizes** and pick `B1s` or `B2ats_v2` (marked "Free services eligible").
7. **Authentication type:** SSH public key. **Username:** `azureuser`. **SSH public key source:** Generate new key pair.
8. **Public inbound ports:** Allow selected ports, then select **HTTP (80)** and **SSH (22)**. This creates the network security group.
9. Click **Review + create**, then **Create**. Click **Download private key and create resource** when asked. Keep the `.pem` file.
10. When it's done, click **Go to resource** and copy the **Public IP address**.

### Google Cloud (Compute Engine)

1. Open the Google Cloud console, go to **Compute Engine**, then **VM instances**. Enable the Compute Engine API if it asks.
2. Click **Create instance**.
3. **Name:** `stagepass`
4. **Region:** `us-central1`, `us-east1`, or `us-west1`. Only these three regions have the always-free `e2-micro`.
5. **Machine type:** series **E2**, then `e2-micro`.
6. **OS and storage:** click **Change**. Operating system **Ubuntu**, version **Ubuntu 24.04 LTS** (x86/64). Boot disk type **Standard persistent disk**, size **30 GB**. The default disk type isn't covered by the free tier.
7. **Networking, Firewall:** check **Allow HTTP traffic**. SSH is already allowed by default.
8. Click **Create**, then copy the **External IP** from the VM list.

---

## Step 2. Connect to the server

**AWS and Azure:** open a terminal on your computer (Terminal on Mac and Linux, PowerShell on Windows) and run:

```bash
# Mac and Linux only: SSH refuses keys that other users can read
chmod 400 ~/Downloads/stagepass.pem

# AWS
ssh -i ~/Downloads/stagepass.pem ubuntu@<public-ip>

# Azure
ssh -i ~/Downloads/stagepass.pem azureuser@<public-ip>
```

Type `yes` when it asks about the fingerprint. Use the path where your `.pem` file actually is.

**Google Cloud:** click the **SSH** button next to the VM in the VM instances list. A terminal opens in your browser.

You're in when you see a prompt like `ubuntu@ip-172-31-...:~$`.

## Step 3. Install the app

On the server, run:

```bash
sudo git clone https://github.com/DeveloperMastery/stagepass.git /opt/stagepass
sudo /opt/stagepass/deploy/setup.sh
```

This takes about 3 to 5 minutes on a free-tier server. It ends with:

```
API is up: {"status":"ok"}

Done. Open http://<your-server-public-ip> in your browser.
```

What the script does, in order:

1. Adds 2 GB of swap, because 1 GB of RAM isn't enough to build the React app
2. Installs Nginx, PostgreSQL, and Node.js 22
3. Creates the database with a random password and writes the config to `/etc/stagepass/api.env`
4. Builds the API, creates the tables, and adds demo events
5. Builds the React app and copies it to `/var/www/stagepass`
6. Starts the API as a systemd service, so it restarts on crash and on reboot
7. Points Nginx at the React files and the API

## Step 4. Check that it works

On the server:

```bash
# All three should say "active (running)"
systemctl status nginx stagepass-api postgresql --no-pager | grep -E "●|Active"

# The API answers through Nginx and can reach the database
curl http://localhost/api/health
```

In your browser, go to `http://<public-ip>`. Type `http://` yourself; there's no HTTPS yet. Then:

1. Log in as `customer@stagepass.dev` / `customer123`
2. Open an event, pick two seats, click **Reserve seats**
3. On checkout, click **Pay**
4. Your tickets show up under **My tickets**
5. Log out, log in as `organizer@stagepass.dev` / `organizer123`, and open **Organizer**. The tickets you bought show as sold, with revenue

If all of that works, the frontend, the API, and the database are all running on your one server.

## Step 5. Run the race condition test

Back on the server:

```bash
cd /opt/stagepass/api
npm run race-test
```

50 users try to reserve the same seat at the same moment. Exactly one should win. The [README](README.md#experiment-sell-one-seat-twice) shows how to turn the lock off and watch the same seat get sold to several people.

---

## If something doesn't work

| What you see | What to do |
| --- | --- |
| Browser spins and times out | Port 80 isn't open. AWS: add an HTTP rule to the security group. Azure: add an inbound rule for port 80 to the network security group. Google Cloud: edit the VM and check **Allow HTTP traffic**. |
| `ssh: connect to host ... timed out` | Port 22 isn't open, or the IP is wrong. Check the IP in the console. |
| `Permission denied (publickey)` | Wrong user or wrong key. AWS uses `ubuntu`, Azure uses the username you set. Check the `-i` path. |
| `502 Bad Gateway` | The API isn't running. Run `sudo journalctl -u stagepass-api -n 50` to see why. |
| `npm` gets `Killed` during setup | Out of memory. Check swap with `free -h`, then run `setup.sh` again. |

## When you're done

A running server uses your free credits even when nobody visits it. Delete it:

- **AWS:** EC2, select the instance, **Instance state**, **Terminate instance**
- **Azure:** open the `stagepass-rg` resource group and click **Delete resource group**. That removes the VM, disk, IP, and firewall together
- **Google Cloud:** VM instances, select the VM, **Delete**
